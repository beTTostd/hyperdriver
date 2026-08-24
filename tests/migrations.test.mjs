import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrations create a new database once with checksums and hardening tables", () => {
  const databaseFile = temporaryDatabase();
  migrate(databaseFile);
  migrate(databaseFile);

  const database = new Database(databaseFile);
  try {
    assert.deepEqual(
      database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version),
      [
        "0000_authentication",
        "0001_user_avatar",
        "0002_replays",
        "0003_user_last_login",
        "0004_replay_game_mode",
        "0005_hardening",
      ],
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 6);
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='replay_metrics'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rate_limit_events'").get());
    assert.ok(database.pragma("table_info(replays)").some((column) => column.name === "size_bytes"));
    assert.ok(database.prepare("SELECT checksum FROM schema_migrations").all().every((row) => /^[a-f0-9]{64}$/.test(row.checksum)));
  } finally {
    database.close();
  }
});

test("migration adoption preserves an existing legacy user and replay", () => {
  const databaseFile = temporaryDatabase();
  const database = new Database(databaseFile);
  try {
    database.exec(readMigration("0000_authentication.sql"));
    database.exec(readMigration("0002_replays.sql"));
    database.exec(readMigration("0003_user_last_login.sql"));
    database.exec(readMigration("0004_replay_game_mode.sql"));
    database.prepare("INSERT INTO users (username, role) VALUES ('legacy', 'user')").run();
    database.prepare(`
      INSERT INTO replays (
        user_id, source_match_id, storage_key, schema_version, status, result,
        started_at, frame_count
      ) VALUES (1, '11111111-1111-4111-8111-111111111111', 'legacy.json', '0.1.0', 'finished', 'victory', 1, 1)
    `).run();
  } finally {
    database.close();
  }

  migrate(databaseFile);
  const migrated = new Database(databaseFile);
  try {
    assert.equal(migrated.prepare("SELECT username FROM users WHERE id=1").get().username, "legacy");
    assert.equal(migrated.prepare("SELECT source_match_id AS id FROM replays WHERE id=1").get().id, "11111111-1111-4111-8111-111111111111");
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 6);
  } finally {
    migrated.close();
  }
});

test("quarantine cleanup restores referenced files and removes committed orphans", () => {
  const databaseFile = temporaryDatabase();
  const uploadsDirectory = join(databaseFile, "..", "uploads");
  migrate(databaseFile);
  const database = new Database(databaseFile);
  try {
    database.pragma("foreign_keys = ON");
    database.prepare("INSERT INTO users (username, role) VALUES ('cleanup', 'user')").run();
    database.prepare(`
      INSERT INTO replays (
        user_id, source_match_id, storage_key, schema_version, status, result,
        started_at, frame_count, size_bytes
      ) VALUES (1, '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json', '0.1.0', 'finished', 'victory', 1, 1, 2)
    `).run();
  } finally {
    database.close();
  }

  const batch = join(uploadsDirectory, ".quarantine", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  mkdirSync(batch, { recursive: true });
  const referenced = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json";
  const orphan = "cccccccc-cccc-4ccc-8ccc-cccccccccccc.json";
  writeFileSync(join(batch, referenced), "{}");
  writeFileSync(join(batch, orphan), "{}");
  const result = spawnSync(process.execPath, ["scripts/cleanup-quarantine.mjs"], {
    env: { ...process.env, DATABASE_FILE: databaseFile, UPLOADS_DIR: uploadsDirectory },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(uploadsDirectory, referenced)), true);
  assert.equal(existsSync(join(batch, orphan)), false);
  assert.equal(existsSync(batch), false);
});

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "hyperdriver-migrations-"));
  temporaryDirectories.push(directory);
  return join(directory, "database.sqlite");
}

function migrate(databaseFile) {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_FILE: databaseFile },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readMigration(name) {
  return readFileSync(join("drizzle", name), "utf8").replaceAll(/--> statement-breakpoint/g, "");
}

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const LEGACY_CHECKS = new Map([
  ["0000_authentication", (database) => hasTables(database, ["users", "password_setup_tokens", "sessions"])],
  ["0001_user_avatar", (database) => hasColumn(database, "users", "avatar_card_id")],
  ["0002_replays", (database) => hasTables(database, ["replays"])],
  ["0003_user_last_login", (database) => hasColumn(database, "users", "last_login_at")],
  ["0004_replay_game_mode", (database) => hasColumn(database, "replays", "game_mode")],
]);

export function configureDatabase(database) {
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
}

export function runMigrations(options = {}) {
  const root = resolve(options.projectRoot || ".");
  const databaseFile = resolve(options.databaseFile || process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
  const migrationsDirectory = resolve(root, "drizzle");
  mkdirSync(dirname(databaseFile), { recursive: true });

  const database = new Database(databaseFile);
  configureDatabase(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  try {
    for (const file of migrationFiles) {
      const version = file.replace(/\.sql$/, "");
      const raw = readFileSync(resolve(migrationsDirectory, file), "utf8");
      const checksum = createHash("sha256").update(raw).digest("hex");
      const applied = database
        .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
        .get(version);
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(`Migration ${version} changed after it was applied.`);
        }
        continue;
      }

      const legacySatisfied = LEGACY_CHECKS.get(version)?.(database) === true;
      const apply = database.transaction(() => {
        if (!legacySatisfied) {
          database.exec(raw.replaceAll(/--> statement-breakpoint/g, ""));
        }
        database
          .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
          .run(version, checksum, Date.now());
      });
      apply.immediate();
    }
  } finally {
    database.close();
  }
}

function hasTables(database, names) {
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  return names.every((name) => Boolean(table.get(name)));
}

function hasColumn(database, table, column) {
  if (!hasTables(database, [table])) return false;
  return database.pragma(`table_info(${table})`).some((entry) => entry.name === column);
}

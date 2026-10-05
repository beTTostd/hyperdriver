import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "../scripts/migration-runner.mjs";
import { recoverOutdatedAnalyses } from "../lib/analysis-recovery.js";

test("evaluator upgrades recover historical analyses and migrated failures exactly once", () => {
  const directory = mkdtempSync(join(tmpdir(), "analysis-recovery-"));
  const databaseFile = join(directory, "test.sqlite");
  runMigrations({ databaseFile });
  const database = new Database(databaseFile);
  database.pragma("foreign_keys = ON");
  try {
    database.prepare("INSERT INTO users (username, role) VALUES ('recovery-test', 'user')").run();
    const add = (id, status, jobStatus, participation = "played", error = null) => {
      database.prepare(`INSERT INTO replays (id, user_id, source_match_id, storage_key, schema_version, status, result, started_at, frame_count, participation)
        VALUES (?, 1, ?, ?, '1', 'finished', 'victory', 1, 1, ?)`)
        .run(id, `match-${id}`, `${id}.json`, participation);
      database.prepare("INSERT INTO replay_analyses (replay_id, status, summary_json) VALUES (?, ?, ?)").run(id, status, '{"historical":true}');
      if (jobStatus) database.prepare(`INSERT INTO analysis_jobs (replay_id, status, attempts, last_error, lease_token, lease_expires_at)
        VALUES (?, ?, 5, ?, 'original-lease', 9999999999999)`).run(id, jobStatus, error);
    };
    add(1, "ready", "ready");
    add(2, "insufficient_data", null);
    add(3, "pending", "running");
    add(4, "pending", "pending");
    add(5, "ready", "ready", "watched");
    add(6, "failed", "failed", "played", "no such column: decision_observations.model_version_id");
    add(7, "failed", "failed", "played", "unrelated failure");
    // An existing lease must be respected even when its summary is historical.
    add(8, "ready", "running");
    add(9, "ready", "ready");
    database.prepare(`INSERT INTO analysis_model_versions (id, analysis_schema, evaluator_version, card_catalog_version, rules_version, talishar_commit)
      VALUES ('new-model', '5', '5', '5', '5', 'test')`).run();
    database.prepare("UPDATE replay_analyses SET model_version_id = 'new-model' WHERE replay_id = 9").run();
    const leases = database.prepare("SELECT * FROM analysis_jobs WHERE replay_id IN (3, 4, 8)").all();
    assert.equal(recoverOutdatedAnalyses(database, "new-model", 100), 3);
    assert.deepEqual(database.prepare("SELECT replay_id FROM replay_analyses WHERE status = 'pending' ORDER BY replay_id").all().map((row) => row.replay_id), [1, 2, 3, 4, 6]);
    assert.deepEqual(database.prepare("SELECT * FROM analysis_jobs WHERE replay_id IN (3, 4, 8)").all(), leases);
    assert.deepEqual(database.prepare("SELECT attempts, lease_token, last_error FROM analysis_jobs WHERE replay_id = 6").get(), { attempts: 0, lease_token: null, last_error: null });
    assert.equal(database.prepare("SELECT summary_json FROM replay_analyses WHERE replay_id = 1").get().summary_json, '{"historical":true}');
    // A repeated startup must not reset retries, including another failed recovery.
    database.prepare("UPDATE analysis_jobs SET status = 'failed', attempts = 5 WHERE replay_id = 6").run();
    database.prepare("UPDATE replay_analyses SET status = 'failed' WHERE replay_id = 6").run();
    assert.equal(recoverOutdatedAnalyses(database, "new-model", 200), 0);
    assert.equal(database.prepare("SELECT attempts FROM analysis_jobs WHERE replay_id = 6").get().attempts, 5);
    // A new evaluator can refresh completed results on the next release.
    database.prepare("UPDATE replay_analyses SET status = 'ready' WHERE replay_id = 1").run();
    database.prepare("UPDATE analysis_jobs SET status = 'ready' WHERE replay_id = 1").run();
    assert.equal(recoverOutdatedAnalyses(database, "next-model", 300), 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

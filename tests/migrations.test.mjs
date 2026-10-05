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
        "0006_replay_metric_version",
        "0007_upload_events",
        "0008_decision_analysis",
        "0009_talishar_elo",
        "0010_player_workspace",
        "0011_coaching_shares",
        "0012_training_goals",
        "0013_replay_participation_admin_json",
        "0014_analysis_jobs_maintenance",
        "0015_decision_score_units",
        "0016_training_exercise_attempts",
      ],
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 17);
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='replay_metrics'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rate_limit_events'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='upload_events'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='decision_observations'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hand_analyses'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='decision_dataset_examples'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='talishar_players'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='elo_ratings'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='elo_matches'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='elo_upload_reports'").get());
    for (const table of ["replay_workspace", "user_tags", "replay_tags", "replay_bookmarks", "replay_shares", "coaching_threads", "coaching_messages", "training_goals", "training_goal_checkins"]) {
      assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    }
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_json_files'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analysis_jobs'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_state'").get());
    assert.ok(database.pragma("table_info(replays)").some((column) => column.name === "size_bytes"));
    assert.ok(database.pragma("table_info(replays)").some((column) => column.name === "participation"));
    assert.ok(database.pragma("table_info(replays)").some((column) => column.name === "participation_source"));
    assert.ok(database.pragma("table_info(replay_metrics)").some((column) => column.name === "calculation_version"));
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
    assert.deepEqual(
      migrated.prepare("SELECT category, http_status AS httpStatus, replay_id AS replayId FROM upload_events").get(),
      { category: "success", httpStatus: 201, replayId: 1 },
    );
    assert.deepEqual(
      migrated.prepare("SELECT participation, participation_source AS participationSource FROM replays WHERE id=1").get(),
      { participation: "unknown", participationSource: null },
    );
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 17);
  } finally {
    migrated.close();
  }
});

test("replay deletion cascades through decision observations, analyses, feedback and collective examples", () => {
  const databaseFile = temporaryDatabase();
  migrate(databaseFile);
  const database = new Database(databaseFile);
  try {
    database.pragma("foreign_keys = ON");
    database.prepare("INSERT INTO users (username, role) VALUES ('analysis-owner', 'user')").run();
    const replay = database.prepare(`
      INSERT INTO replays (
        user_id, source_match_id, storage_key, schema_version, status, result,
        started_at, frame_count, size_bytes
      ) VALUES (1, '44444444-4444-4444-8444-444444444444', 'analysis.json', '0.3.0', 'finished', 'unknown', 1, 1, 2)
      RETURNING id
    `).get();
    database.prepare(`
      INSERT INTO analysis_model_versions (
        id, analysis_schema, evaluator_version, card_catalog_version, rules_version, talishar_commit
      ) VALUES ('model-1', '1.0.0', 'evaluator-1', 'catalog-1', 'rules-1', 'commit-1')
    `).run();
    database.prepare("INSERT INTO replay_analyses (replay_id, model_version_id, status) VALUES (?, 'model-1', 'ready')").run(replay.id);
    const observation = database.prepare(`
      INSERT INTO decision_observations (
        replay_id, ordinal, frame_sequence, frame_index, kind, state_fingerprint,
        hand_fingerprint, data_quality, state_json, legal_actions_json
      ) VALUES (?, 1, 1, 0, 'action', 'state', 'hand', 'captured', '{}', '[]')
      RETURNING id
    `).get(replay.id);
    database.prepare(`
      INSERT INTO hand_analyses (
        replay_id, observation_id, model_version_id, state_fingerprint,
        frame_sequence, frame_index, decision_kind, confidence, hand_potential,
        execution_quality, chosen_value, best_value, regret_pp, tags_json, analysis_json
      ) VALUES (?, ?, 'model-1', 'state', 1, 0, 'action', 'medium', 50, 90, 50, 51, 1, '[]', '{}')
    `).run(replay.id, observation.id);
    database.prepare("INSERT INTO analysis_feedback (replay_id, user_id, analysis_fingerprint, helpful) VALUES (?, 1, 'state', 1)").run(replay.id);
    database.prepare("INSERT INTO training_exercise_attempts (user_id, replay_id, exercise_key, model_version_id, chosen_action_key, within_tolerance, score_gap, created_at, updated_at) VALUES (1, ?, 'exercise', 'model-1', 'choice', 1, 0, 1, 1)").run(replay.id);
    database.prepare(`
      INSERT INTO decision_dataset_examples (
        replay_id, model_version_id, example_key, user_cohort, decision_kind, payload_json
      ) VALUES (?, 'model-1', 'example-1', 'cohort-1', 'action', '{}')
    `).run(replay.id);
    database.prepare("INSERT INTO replay_workspace (replay_id, user_id, note, is_favorite) VALUES (?, 1, 'note', 1)").run(replay.id);
    const tag = database.prepare("INSERT INTO user_tags (user_id, name, normalized_name) VALUES (1, 'Defense', 'defense') RETURNING id").get();
    database.prepare("INSERT INTO replay_tags (replay_id, tag_id) VALUES (?, ?)").run(replay.id, tag.id);
    database.prepare("INSERT INTO replay_bookmarks (replay_id, user_id, frame_index, title) VALUES (?, 1, 0, 'Start')").run(replay.id);
    database.prepare("INSERT INTO replay_shares (id, replay_id, user_id, token_hash, coach_name, expires_at) VALUES ('share-1', ?, 1, 'hash', 'Coach', ?)").run(replay.id, Date.now() + 1000);
    const thread = database.prepare("INSERT INTO coaching_threads (share_id, replay_id, frame_index) VALUES ('share-1', ?, 0) RETURNING id").get(replay.id);
    database.prepare("INSERT INTO coaching_messages (thread_id, author_role, body) VALUES (?, 'coach', 'Review this')").run(thread.id);
    const goal = database.prepare("INSERT INTO training_goals (user_id, title, origin, source_replay_id) VALUES (1, 'Historical goal', 'manual', ?) RETURNING id").get(replay.id);
    database.prepare("INSERT INTO training_goal_checkins (goal_id, replay_id, state) VALUES (?, ?, 'met')").run(goal.id, replay.id);

    database.prepare("DELETE FROM replays WHERE id = ?").run(replay.id);
    for (const table of [
      "replay_analyses",
      "decision_observations",
      "hand_analyses",
      "analysis_feedback",
      "training_exercise_attempts",
      "decision_dataset_examples",
    ]) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analysis_model_versions").get().count, 1);
    for (const table of ["replay_workspace", "replay_tags", "replay_bookmarks", "replay_shares", "coaching_threads", "coaching_messages"]) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    assert.deepEqual(database.prepare("SELECT source_replay_id AS sourceReplayId FROM training_goals WHERE id = ?").get(goal.id), { sourceReplayId: null });
    assert.deepEqual(database.prepare("SELECT replay_id AS replayId FROM training_goal_checkins WHERE goal_id = ?").get(goal.id), { replayId: null });
  } finally {
    database.close();
  }
});

test("backfill recalculates metrics created by an older telemetry algorithm", () => {
  const databaseFile = temporaryDatabase();
  const uploadsDirectory = join(databaseFile, "..", "uploads");
  const storageKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json";
  const document = playerTwoReplay("33333333-3333-4333-8333-333333333333");
  const raw = JSON.stringify(document);
  mkdirSync(uploadsDirectory, { recursive: true });
  writeFileSync(join(uploadsDirectory, storageKey), raw);
  migrate(databaseFile);

  const database = new Database(databaseFile);
  try {
    database.prepare("INSERT INTO users (username, role) VALUES ('telemetry', 'user')").run();
    const replay = database.prepare(`
      INSERT INTO replays (
        user_id, source_match_id, storage_key, schema_version, status, result,
        game_mode, started_at, frame_count, size_bytes
      ) VALUES (1, ?, ?, '0.1.0', 'finished', 'unknown', 'cc', 1, 4, ?)
      RETURNING id
    `).get(document.match.id, storageKey, Buffer.byteLength(raw, "utf8"));
    database.prepare(`
      INSERT INTO replay_metrics (
        replay_id, received_damage, equipment_blocked, card_blocked,
        offered_damage, life_gained, cycle_count, calculation_version
      ) VALUES (?, 99, 99, 99, 99, 99, 99, 1)
    `).run(replay.id);
  } finally {
    database.close();
  }

  const result = spawnSync(process.execPath, ["scripts/backfill-replays.mjs"], {
    env: { ...process.env, DATABASE_FILE: databaseFile, UPLOADS_DIR: uploadsDirectory },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const updated = new Database(databaseFile, { readonly: true });
  try {
    assert.deepEqual(
      updated.prepare(`
        SELECT received_damage AS receivedDamage,
          equipment_blocked AS equipmentBlocked,
          card_blocked AS cardBlocked,
          offered_damage AS offeredDamage,
          life_gained AS lifeGained,
          cycle_count AS cycleCount,
          calculation_version AS calculationVersion
        FROM replay_metrics
      `).get(),
      {
        receivedDamage: 5,
        equipmentBlocked: 3,
        cardBlocked: 0,
        offeredDamage: 6,
        lifeGained: 0,
        cycleCount: 1,
        calculationVersion: 2,
      },
    );
  } finally {
    updated.close();
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

function playerTwoReplay(id) {
  const playerEquipment = [
    { slot: "Hero", cardNumber: "player_two_hero", controller: "2" },
    { slot: "Chest", cardNumber: "player_two_shield", controller: "2" },
  ];
  const opponentEquipment = [{ slot: "Hero", cardNumber: "player_one_hero", controller: "1" }];
  const payload = (turnPlayer, activeChainLink, turnPhase = "A") => ({
    turnNo: "1",
    turnPlayer,
    otherPlayer: "1",
    turnPhase: { turnPhase },
    playerHealth: "20",
    opponentHealth: "20",
    playerEquipment,
    opponentEquipment,
    activeChainLink,
  });
  return {
    schemaVersion: "0.1.0",
    match: {
      id,
      status: "finished",
      startedAt: "2026-08-24T22:35:54.020Z",
      endedAt: "2026-08-24T22:42:34.511Z",
      frames: [
        { payload: payload("1", {
          attackingCard: { cardNumber: "opponent_attack_red", controller: "1" },
          totalPower: 8,
          totalDefense: 3,
          reactions: [{ cardNumber: "player_two_shield", controller: "2" }],
        }) },
        { payload: payload("1", null) },
        { payload: payload("2", {
          attackingCard: { cardNumber: "player_attack_red", controller: "2" },
          totalPower: 6,
          totalDefense: 2,
          reactions: [{ cardNumber: "opponent_guard_red", controller: "1" }],
        }) },
        { payload: payload("2", null, "OVER") },
      ],
    },
  };
}

test("score-unit migration preserves historical values, model identity and goal denominators", () => {
  const databaseFile = temporaryDatabase();
  migrate(databaseFile);
  const database = new Database(databaseFile);
  try {
    // Build the pre-upgrade analysis tables in isolation to exercise the data migration.
    const legacy = new Database(":memory:");
    try {
      legacy.exec(`CREATE TABLE replays (id INTEGER PRIMARY KEY); CREATE TABLE users (id INTEGER PRIMARY KEY);`);
      legacy.exec(readMigration("0008_decision_analysis.sql"));
      legacy.exec(readMigration("0012_training_goals.sql"));
      legacy.exec(`
        INSERT INTO replays VALUES (1);
        INSERT INTO users VALUES (1);
        INSERT INTO analysis_model_versions (id, analysis_schema, evaluator_version, card_catalog_version, rules_version, talishar_commit)
          VALUES ('old', '1.1.0', 'old-evaluator', 'old-catalog', 'old-rules', 'old-commit');
        INSERT INTO replay_analyses (replay_id, model_version_id, status) VALUES (1, 'old', 'ready');
        INSERT INTO decision_observations (id, replay_id, ordinal, frame_sequence, frame_index, kind, state_fingerprint, hand_fingerprint, data_quality, state_json, legal_actions_json)
          VALUES (1, 1, 1, 1, 0, 'pitch', 'state', 'hand', 'captured', '{}', '[]');
        INSERT INTO hand_analyses (replay_id, observation_id, model_version_id, state_fingerprint, frame_sequence, frame_index, decision_kind, confidence, hand_potential, execution_quality, chosen_value, best_value, regret_pp, tags_json, analysis_json)
          VALUES (1, 1, 'old', 'state', 1, 0, 'pitch', 'medium', 50, 60, 40, 45, 5, '[]', '{"old":true}');
        INSERT INTO training_goals (user_id, title, origin, source_replay_id, baseline_rate)
          VALUES (1, 'Old goal', 'analysis_pattern', 1, 25);
      `);
      legacy.exec(readMigration("0015_decision_score_units.sql"));
      assert.deepEqual(legacy.prepare("SELECT score_unit, model_version_id, chosen_value, regret_pp, analysis_json FROM hand_analyses").get(), {
        score_unit: "legacy_win_probability", model_version_id: "old", chosen_value: 40, regret_pp: 5, analysis_json: '{"old":true}',
      });
      assert.deepEqual(legacy.prepare("SELECT model_version_id, metric_version, baseline_rate FROM training_goals").get(), {
        model_version_id: "old", metric_version: "all_decisions_v1", baseline_rate: 25,
      });
      assert.equal(legacy.prepare("SELECT model_version_id FROM decision_observations").get().model_version_id, "old");
      legacy.exec(`INSERT INTO analysis_model_versions (id, analysis_schema, evaluator_version, card_catalog_version, rules_version, talishar_commit)
        VALUES ('new', '2.0.0', 'new-evaluator', 'new-catalog', 'new-rules', 'new-commit');`);
      // The same decision ordinal may coexist in two methodologies.
      legacy.exec(`INSERT INTO decision_observations (replay_id, ordinal, model_version_id, frame_sequence, frame_index, kind, state_fingerprint, hand_fingerprint, data_quality, state_json, legal_actions_json)
        VALUES (1, 1, 'new', 1, 0, 'pitch', 'new-state', 'hand', 'captured', '{}', '[]');`);
      assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM decision_observations").get().count, 2);
    } finally {
      legacy.close();
    }
  } finally {
    database.close();
  }
});

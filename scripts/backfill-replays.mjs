import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  calculateReplayTelemetryCore,
  TELEMETRY_ALGORITHM_VERSION,
} from "../lib/replay-telemetry-core.js";
import { replayResult } from "../talishar-local-history/replay-state.js";
import { configureDatabase } from "./migration-runner.mjs";

const databaseFile = resolve(process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
const uploadsDirectory = resolve(process.env.UPLOADS_DIR || "data/uploads");
const database = new Database(databaseFile);
configureDatabase(database);
const backfillKey = `replay_metadata_v${TELEMETRY_ALGORITHM_VERSION}`;
const completedBackfill = database.prepare("SELECT value FROM maintenance_state WHERE key = ?").get(backfillKey);
if (completedBackfill?.value === "complete") {
  database.close();
  console.log(JSON.stringify({ level: "info", type: "replay_backfill_already_complete", version: backfillKey }));
  process.exit(0);
}

const pending = database.prepare(`
  SELECT r.id, r.storage_key AS storageKey
  FROM replays r
  LEFT JOIN replay_metrics m ON m.replay_id = r.id
  WHERE r.size_bytes = 0 OR m.replay_id IS NULL OR r.game_mode IS NULL
    OR m.calculation_version < ${TELEMETRY_ALGORITHM_VERSION}
  ORDER BY r.id
`).all();
const updateReplay = database.prepare(`
  UPDATE replays
  SET size_bytes = ?, result = ?, game_mode = COALESCE(game_mode, ?),
      player_hero_id = COALESCE(player_hero_id, ?),
      opponent_hero_id = COALESCE(opponent_hero_id, ?),
      ended_at = COALESCE(ended_at, ?), final_turn = COALESCE(final_turn, ?), frame_count = ?
  WHERE id = ?
`);
const upsertMetrics = database.prepare(`
  INSERT INTO replay_metrics (
    replay_id, received_damage, equipment_blocked, card_blocked,
    offered_damage, life_gained, cycle_count, calculation_version, calculated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(replay_id) DO UPDATE SET
    received_damage = excluded.received_damage,
    equipment_blocked = excluded.equipment_blocked,
    card_blocked = excluded.card_blocked,
    offered_damage = excluded.offered_damage,
    life_gained = excluded.life_gained,
    cycle_count = excluded.cycle_count,
    calculation_version = excluded.calculation_version,
    calculated_at = excluded.calculated_at
`);
const save = database.transaction((id, raw, document, metrics) => {
  const frames = document.match.frames;
  const finalFrame = [...frames].reverse().find(
    (frame) => frame?.payload?.turnPhase?.turnPhase === "OVER",
  ) ?? frames.at(-1);
  updateReplay.run(
    Buffer.byteLength(raw, "utf8"),
    replayResult(document.match),
    gameMode(document),
    heroId(frames, "playerEquipment"),
    heroId(frames, "opponentEquipment"),
    timestamp(document.match.endedAt) ?? timestamp(finalFrame?.receivedAt),
    finiteNumber(finalFrame?.payload?.turnNo),
    frames.length,
    id,
  );
  upsertMetrics.run(
    id,
    metrics.receivedDamage,
    metrics.equipmentBlocked,
    metrics.cardBlocked,
    metrics.offeredDamage,
    metrics.lifeGained,
    metrics.cycleCount,
    TELEMETRY_ALGORITHM_VERSION,
    Date.now(),
  );
});

let completed = 0;
let failed = 0;
for (const replay of pending) {
  try {
    if (basename(replay.storageKey) !== replay.storageKey || !/^[a-f0-9-]+\.json$/i.test(replay.storageKey)) {
      throw new Error("invalid storage key");
    }
    const raw = await readFile(resolve(uploadsDirectory, replay.storageKey), "utf8");
    const document = JSON.parse(raw);
    if (!Array.isArray(document?.match?.frames)) throw new Error("invalid replay");
    const metrics = totals(calculateReplayTelemetryCore(document));
    save.immediate(replay.id, raw, document, metrics);
    completed += 1;
  } catch (error) {
    failed += 1;
    console.warn(JSON.stringify({
      level: "warn",
      type: "replay_backfill_skipped",
      replayId: replay.id,
      reason: error instanceof Error ? error.message : "unknown",
    }));
  }
}

if (failed === 0) {
  database.prepare(`
    INSERT INTO maintenance_state (key, value, updated_at) VALUES (?, 'complete', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(backfillKey, Date.now());
}
database.close();
console.log(JSON.stringify({ level: "info", type: "replay_backfill_complete", version: backfillKey, scanned: pending.length, completed, failed }));

function totals(cycles) {
  return cycles.reduce((value, cycle) => ({
    receivedDamage: value.receivedDamage + finiteNumber(cycle.receivedDamage, 0),
    equipmentBlocked: value.equipmentBlocked + finiteNumber(cycle.equipmentBlocked, 0),
    cardBlocked: value.cardBlocked + finiteNumber(cycle.cardBlocked, 0),
    offeredDamage: value.offeredDamage + finiteNumber(cycle.offeredDamage, 0),
    lifeGained: value.lifeGained + finiteNumber(cycle.lifeGained, 0),
    cycleCount: value.cycleCount + 1,
  }), {
    receivedDamage: 0,
    equipmentBlocked: 0,
    cardBlocked: 0,
    offeredDamage: 0,
    lifeGained: 0,
    cycleCount: 0,
  });
}

function heroId(frames, side) {
  for (const frame of frames) {
    const cards = frame?.payload?.[side];
    if (!Array.isArray(cards)) continue;
    const hero = cards.find((card) => card?.slot === "Hero" && typeof card.cardNumber === "string");
    if (hero) return hero.cardNumber;
  }
  return null;
}

function gameMode(document) {
  const values = [
    document.match.gameFormat,
    ...document.match.frames.map((frame) => frame?.payload?.initialLoad?.gameFormat),
  ];
  const value = values.find((entry) => typeof entry === "string" && entry.trim());
  return value ? value.trim().toLowerCase() : null;
}

function timestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

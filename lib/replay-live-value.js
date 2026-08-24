import { calculateReplayTurnTelemetryCore } from "./replay-telemetry-core.js";
import { localPlayerNumber } from "../talishar-local-history/replay-state.js";

export const REPLAY_VALUE_METRICS = Object.freeze([
  "receivedDamage",
  "equipmentBlocked",
  "cardBlocked",
  "lifeGained",
  "offeredDamage",
]);

export function replayTurnValue(turn) {
  return REPLAY_VALUE_METRICS.reduce((total, metric) => total + Number(turn?.[metric] ?? 0), 0);
}

export function calculateLiveReplayValue(frames, index = frames?.length - 1) {
  const source = Array.isArray(frames) ? frames : [];
  const lastIndex = Number.isFinite(index)
    ? Math.min(source.length - 1, Math.max(-1, Math.trunc(index)))
    : source.length - 1;
  const match = { frames: source.slice(0, lastIndex + 1) };
  const turns = calculateReplayTurnTelemetryCore({ match });
  const currentTurn = turns.at(-1) ?? null;
  return {
    localPlayer: localPlayerNumber(match) ?? "1",
    turns,
    currentTurn,
    turnValue: replayTurnValue(currentTurn),
    matchValue: turns.reduce((total, turn) => total + replayTurnValue(turn), 0),
  };
}

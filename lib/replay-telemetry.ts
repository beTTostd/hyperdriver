import type { ReplayDocument } from "./replays";
import { calculateReplayTelemetryCore } from "./replay-telemetry-core.js";

export type TelemetryCycle = {
  key: string;
  turn: string;
  partial: "initial" | "final" | null;
  receivedDamage: number;
  equipmentBlocked: number;
  cardBlocked: number;
  offeredDamage: number;
  lifeGained: number;
};

export function calculateReplayTelemetry(document: ReplayDocument): TelemetryCycle[] {
  return calculateReplayTelemetryCore(document) as TelemetryCycle[];
}

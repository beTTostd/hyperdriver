import type { ReplayDocument } from "./replays";
import {
  calculateReplayTelemetryCore,
  calculateReplayTurnTelemetryCore,
  TELEMETRY_ALGORITHM_VERSION as telemetryAlgorithmVersion,
} from "./replay-telemetry-core.js";

export const TELEMETRY_ALGORITHM_VERSION = telemetryAlgorithmVersion as number;

export type TelemetryTurn = {
  key: string;
  turn: string;
  player: "1" | "2";
  receivedDamage: number;
  equipmentBlocked: number;
  cardBlocked: number;
  offeredDamage: number;
  lifeGained: number;
  dealtDamage: number;
  attackEquipmentBlocked: number;
  attackCardBlocked: number;
};

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

export function calculateReplayTurnTelemetry(document: ReplayDocument): TelemetryTurn[] {
  return calculateReplayTurnTelemetryCore(document) as TelemetryTurn[];
}

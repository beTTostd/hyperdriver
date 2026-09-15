import { parseReplayDocument, type ReplayDocument } from "./replays";
import {
  CURRENT_REPLAY_SCHEMA_VERSION,
  REPLAY_API_CONTRACT_VERSION,
} from "../talishar-local-history/replay-contract.js";

export { CURRENT_REPLAY_SCHEMA_VERSION, REPLAY_API_CONTRACT_VERSION };

export type ReplayManifest = {
  contractVersion: number;
  replaySchemaVersion: string;
  id: string;
  status: string;
  result: string;
  startedAt: number;
  endedAt: number | null;
  frameCount: number;
  framePageSize: number;
};

export type ReplayFramePage = {
  contractVersion: number;
  replaySchemaVersion: string;
  start: number;
  frames: ReplayDocument["match"]["frames"];
  nextCursor: string | null;
};

export function validateAndAdaptReplayDocument(raw: string): ReplayDocument {
  // parseReplayDocument accepts supported historical schemas and returns the
  // normalized contract consumed by the current application.
  return parseReplayDocument(raw);
}

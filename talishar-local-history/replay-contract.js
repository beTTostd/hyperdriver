export const REPLAY_API_CONTRACT_VERSION = 1;
export const CURRENT_REPLAY_SCHEMA_VERSION = "0.6.0";

export const SYNC_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: "AUTH_REQUIRED",
  BODY_TOO_LARGE: "BODY_TOO_LARGE",
  DUPLICATE_REPLAY: "DUPLICATE_REPLAY",
  PARTIAL_REPLAY: "PARTIAL_REPLAY",
  RATE_LIMITED: "RATE_LIMITED",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
});

export function replaySchemaMajor(version) {
  const match = typeof version === "string" ? version.match(/^(\d+)\./) : null;
  return match ? Number(match[1]) : null;
}

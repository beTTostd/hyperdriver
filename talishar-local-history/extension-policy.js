export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_BRIDGE_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_FRAME_BYTES = 512 * 1024;
export const MAX_MATCH_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_STORED_MATCHES = 100;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function utf8Size(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function createKeyedTaskQueue() {
  const queues = new Map();

  return function enqueue(key, task) {
    const previous = queues.get(key) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (queues.get(key) === current) queues.delete(key);
      });
    queues.set(key, current);
    return current;
  };
}

export function isValidImportedCandidate(candidate) {
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    typeof candidate.id === "string" &&
    UUID_PATTERN.test(candidate.id) &&
    typeof candidate.startedAt === "string" &&
    Number.isFinite(Date.parse(candidate.startedAt)) &&
    Array.isArray(candidate.frames) &&
    candidate.frames.length > 0 &&
    candidate.frames.every((frame) => (
      frame &&
      typeof frame === "object" &&
      !Array.isArray(frame) &&
      frame.payload &&
      typeof frame.payload === "object" &&
      !Array.isArray(frame.payload)
    )),
  );
}

export function matchesToPrune(matches, protectedId = null, incomingBytes = 0) {
  let remainingCount = matches.length;
  let remainingBytes = matches.reduce(
    (total, match) => total + (Number(match.capturedBytes) || utf8Size(JSON.stringify(match))),
    incomingBytes,
  );
  const candidates = matches
    .filter((match) => (
      match.id !== protectedId &&
      match.status === "finished" &&
      (match.exportedAt || match.sync?.uploadedAt)
    ))
    .sort((a, b) => String(a.updatedAt || a.startedAt || "").localeCompare(String(b.updatedAt || b.startedAt || "")));
  const ids = [];

  for (const match of candidates) {
    if (remainingCount <= MAX_STORED_MATCHES && remainingBytes <= MAX_TOTAL_BYTES) break;
    ids.push(match.id);
    remainingCount -= 1;
    remainingBytes -= Number(match.capturedBytes) || utf8Size(JSON.stringify(match));
  }

  return ids;
}

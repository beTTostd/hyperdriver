export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_BRIDGE_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_FRAME_BYTES = 512 * 1024;
export const MAX_MATCH_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_STORED_MATCHES = 10;
export const MATCHES_PER_PAGE = 5;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TALISHAR_DOMAIN = "talishar.net";
const HYPERDRIVER_DOMAIN = "hyperdriver.com.br";

export function isAllowedHttpsOrigin(origin, domain) {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    );
  } catch {
    return false;
  }
}

export function isTalisharOrigin(origin) {
  return isAllowedHttpsOrigin(origin, TALISHAR_DOMAIN);
}

export function isHyperdriverOrigin(origin) {
  return isAllowedHttpsOrigin(origin, HYPERDRIVER_DOMAIN);
}

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

export function canAppendCaptureFrame(match) {
  return match?.status !== "finished";
}

export function matchPagination(total, requestedPage, pageSize = MATCHES_PER_PAGE) {
  const normalizedTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const normalizedPageSize = Number.isSafeInteger(pageSize) && pageSize > 0
    ? pageSize
    : MATCHES_PER_PAGE;
  const pageCount = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));
  const parsedPage = Number(requestedPage);
  const page = Math.min(
    pageCount,
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  );

  return {
    page,
    pageCount,
    pageSize: normalizedPageSize,
    total: normalizedTotal,
    offset: (page - 1) * normalizedPageSize,
  };
}

export function captureMatchesPage(match, pageUrl) {
  return Boolean(match && match.capture?.pageUrl === pageUrl);
}

export function normalizeGameId(value) {
  if (!["string", "number"].includes(typeof value)) return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 128 && /^[\p{L}\p{N}_.:-]+$/u.test(normalized)
    ? normalized
    : null;
}

export function captureGameId(match) {
  const stored = normalizeGameId(match?.capture?.gameId);
  if (stored) return stored;
  const frames = Array.isArray(match?.frames) ? match.frames : [];
  for (const frame of frames) {
    const gameId = normalizeGameId(frame?.payload?.initialLoad?.gameGUID);
    if (gameId) return gameId;
  }
  return null;
}

export function captureMatchesGame(match, gameId) {
  const normalized = normalizeGameId(gameId);
  return Boolean(normalized && captureGameId(match) === normalized);
}

export function resumableCaptureForPage(matches, pageUrl, gameId = null) {
  if (!Array.isArray(matches) || typeof pageUrl !== "string" || !pageUrl) return null;
  const normalizedGameId = normalizeGameId(gameId);
  const stableGamePage = /^\/game\/play\/[^/]+$/.test(pageUrl);
  if (!normalizedGameId && !stableGamePage) return null;
  return [...matches]
    .filter((match) => (
      match?.status === "recording" && (
        normalizedGameId
          ? captureMatchesGame(match, normalizedGameId)
          : captureMatchesPage(match, pageUrl)
      )
    ))
    .sort((left, right) => String(right.updatedAt || right.startedAt || "").localeCompare(String(left.updatedAt || left.startedAt || "")))[0]
    ?? null;
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
      (
        (match.status === "recording" && Array.isArray(match.frames) && match.frames.length === 0) ||
        (
          match.status === "finished" &&
          (
            match.exportedAt ||
            match.sync?.uploadedAt ||
            Object.values(match.sync?.targets || {}).some((target) => target?.uploadedAt)
          )
        )
      )
    ))
    .sort((a, b) => {
      const aIsEmptyCapture = a.status === "recording" && Array.isArray(a.frames) && a.frames.length === 0;
      const bIsEmptyCapture = b.status === "recording" && Array.isArray(b.frames) && b.frames.length === 0;
      if (aIsEmptyCapture !== bIsEmptyCapture) return aIsEmptyCapture ? -1 : 1;
      return String(a.updatedAt || a.startedAt || "").localeCompare(String(b.updatedAt || b.startedAt || ""));
    });
  const ids = [];

  for (const match of candidates) {
    if (remainingCount <= MAX_STORED_MATCHES && remainingBytes <= MAX_TOTAL_BYTES) break;
    ids.push(match.id);
    remainingCount -= 1;
    remainingBytes -= Number(match.capturedBytes) || utf8Size(JSON.stringify(match));
  }

  return ids;
}

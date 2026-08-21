export function findFirstByKey(value, keys, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstByKey(item, keys, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase()) && (typeof item === "string" || typeof item === "number" || typeof item === "boolean")) return item;
    const found = findFirstByKey(item, keys, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

const CARD_FIELDS = [
  "cardNumber",
  "slot",
  "controller",
  "counters",
  "countersMap",
  "tapped",
  "isBroken",
  "onChain",
];

const CARD_ARRAY_FIELDS = [
  "opponentHand",
  "opponentDiscard",
  "opponentPitch",
  "opponentBanish",
  "opponentEquipment",
  "opponentArse",
  "opponentAllies",
  "opponentAuras",
  "opponentItems",
  "opponentPermanents",
  "playerHand",
  "playerDiscard",
  "playerPitch",
  "playerBanish",
  "playerEquipment",
  "playerArse",
  "playerAllies",
  "playerAuras",
  "playerItems",
  "playerPermanents",
];

const CARD_FIELDS_SET = new Set(CARD_FIELDS);
const SCALAR_FIELDS = [
  "opponentHealth",
  "opponentDeckCount",
  "playerHealth",
  "playerDeckCount",
  "turnNo",
  "turnPlayer",
];
const SINGLE_CARD_FIELDS = new Set([
  "opponentDeckCard",
  "playerDeckCard",
  "lastPlayedCard",
]);

function isScalar(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function compactCard(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const card = {};
  for (const [key, item] of Object.entries(value)) {
    if (!CARD_FIELDS_SET.has(key)) continue;
    if (key === "countersMap") {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        card[key] = Object.fromEntries(
          Object.entries(item).filter(([, counter]) => isScalar(counter)),
        );
      }
      continue;
    }
    if (isScalar(item)) card[key] = item;
  }
  return card;
}

function compactCardList(value) {
  return Array.isArray(value)
    ? value.map(compactCard).filter(Boolean)
    : [];
}

function compactTurnPhase(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const phase = {};
  for (const key of ["turnPhase", "layer", "caption"]) {
    if (isScalar(value[key])) phase[key] = value[key];
  }
  return phase;
}

function compactChain(value) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const chain = {};
  for (const key of ["totalPower", "totalDefense", "attackTarget", "goAgain", "dominate", "overpower"]) {
    if (isScalar(value[key])) chain[key] = value[key];
  }
  if (Object.prototype.hasOwnProperty.call(value, "attackingCard")) {
    chain.attackingCard = compactCard(value.attackingCard);
  }
  if (Array.isArray(value.reactions)) chain.reactions = compactCardList(value.reactions);
  return chain;
}

function compactIndicators(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of ["turn", "activePlayer", "gameOver", "winner", "phase"]) {
    if (isScalar(value[key])) result[key] = value[key];
  }
  return result;
}

/**
 * Keep only the state consumed by the replay table and telemetry.
 * Talishar sends chat, account, deck metadata and UI plumbing in every SSE
 * frame; none of those fields are needed to reproduce the board.
 */
export function compactReplayPayload(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = {};

  if (value.initialLoad && typeof value.initialLoad === "object" && !Array.isArray(value.initialLoad)) {
    if (isScalar(value.initialLoad.gameFormat)) {
      payload.initialLoad = { gameFormat: value.initialLoad.gameFormat };
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "turnPhase")) {
    payload.turnPhase = compactTurnPhase(value.turnPhase);
  }
  if (Object.prototype.hasOwnProperty.call(value, "activeChainLink")) {
    payload.activeChainLink = compactChain(value.activeChainLink);
  }
  for (const key of CARD_ARRAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) payload[key] = compactCardList(value[key]);
  }
  for (const key of SINGLE_CARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) payload[key] = compactCard(value[key]);
  }
  for (const key of SCALAR_FIELDS) {
    if (isScalar(value[key])) payload[key] = value[key];
  }

  return payload;
}

export function compactReplayFrame(frame) {
  if (frame === null || typeof frame !== "object" || Array.isArray(frame)) {
    return { payload: {} };
  }
  return {
    ...(isScalar(frame.sequence) ? { sequence: frame.sequence } : {}),
    ...(isScalar(frame.receivedAt) ? { receivedAt: frame.receivedAt } : {}),
    ...(isScalar(frame.endpoint) ? { endpoint: frame.endpoint } : {}),
    ...(frame.indicators && typeof frame.indicators === "object" ? { indicators: compactIndicators(frame.indicators) } : {}),
    payload: compactReplayPayload(frame.payload),
  };
}

function compactRecord(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of fields) {
    if (isScalar(value[key])) result[key] = value[key];
  }
  return result;
}

export function compactReplayMatch(match) {
  if (match === null || typeof match !== "object" || Array.isArray(match)) return match;
  const compacted = compactRecord(match, [
    "id",
    "schemaVersion",
    "status",
    "startedAt",
    "updatedAt",
    "endedAt",
    "result",
    "exportedAt",
    "gameFormat",
    "capturedBytes",
  ]) || {};
  if (match.capture) {
    compacted.capture = compactRecord(match.capture, ["source", "startedAt", "pageUrl", "privacy"]);
  }
  if (match.summary) {
    compacted.summary = compactRecord(match.summary, ["turn", "activePlayer", "winner"]);
  }
  if (match.sync) {
    compacted.sync = compactRecord(match.sync, ["uploadedAt", "origin", "username", "replayId"]);
  }
  if (match.syncError) {
    compacted.syncError = compactRecord(match.syncError, ["at", "message"]);
  }
  compacted.frames = Array.isArray(match.frames) ? match.frames.map(compactReplayFrame) : [];
  return compacted;
}

export function compactReplayDocument(document) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) return document;
  const hasEnvelope = document.match !== undefined;
  const match = hasEnvelope ? document.match : document;
  if (match === null || typeof match !== "object" || Array.isArray(match)) return document;
  const compactedMatch = compactReplayMatch(match);
  if (!hasEnvelope) return compactedMatch;
  return {
    ...(isScalar(document.schemaVersion) ? { schemaVersion: document.schemaVersion } : {}),
    ...(isScalar(document.exportedAt) ? { exportedAt: document.exportedAt } : {}),
    match: compactedMatch,
  };
}

export function indicators(payload) {
  return {
    turn: findFirstByKey(payload, ["turn", "turnno", "turnnumber", "currentturn"]),
    activePlayer: findFirstByKey(payload, ["activeplayer", "currentplayer", "playerturn"]),
    gameOver: findFirstByKey(payload, ["gameover", "gameended", "matchended"]),
    winner: findFirstByKey(payload, ["winner", "winningplayer"]),
    phase: findFirstByKey(payload, ["turnphase"])
  };
}

export function isFinished(indicator) {
  const gameOver = typeof indicator.gameOver === "string" ? indicator.gameOver.trim().toLowerCase() : indicator.gameOver;
  const phase = typeof indicator.phase === "string" ? indicator.phase.trim().toUpperCase() : indicator.phase;
  return gameOver === true || gameOver === "true" || gameOver === "1" || gameOver === 1 || phase === "OVER";
}

export function isCompleteMatch(match) {
  if (match.status === "finished") return true;
  return match.frames.some((frame) => isFinished(frame.indicators || indicators(frame.payload)));
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function winnerResult(value) {
  if (value === 1 || value === "1") return "victory";
  if (value === 2 || value === "2") return "defeat";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["player", "you", "self", "local"].includes(normalized)) return "victory";
  if (["opponent", "enemy", "other"].includes(normalized)) return "defeat";
  return null;
}

function finalFrame(match) {
  return [...(Array.isArray(match?.frames) ? match.frames : [])].reverse().find((frame) => {
    const phase = frame?.payload?.turnPhase?.turnPhase;
    return typeof phase === "string" && phase.toUpperCase() === "OVER";
  }) ?? match?.frames?.at(-1);
}

function pendingAttackResult(frame) {
  const attack = frame?.payload?.activeChainLink;
  const controller = String(attack?.attackingCard?.controller ?? "");
  const power = numeric(attack?.totalPower);
  const defense = numeric(attack?.totalDefense);
  if (!power || !["1", "2"].includes(controller)) return null;
  const damage = Math.max(0, power - (defense ?? 0));
  if (damage <= 0) return null;
  return controller === "1" ? "victory" : "defeat";
}

export function replayResult(match) {
  const frame = finalFrame(match);
  const winner = winnerResult(frame?.indicators?.winner)
    ?? winnerResult(match?.summary?.winner);
  if (winner) return winner;

  const playerHealth = numeric(frame?.payload?.playerHealth);
  const opponentHealth = numeric(frame?.payload?.opponentHealth);
  if (playerHealth !== null && playerHealth <= 0) return "defeat";
  if (opponentHealth !== null && opponentHealth <= 0) return "victory";

  const attack = frame?.payload?.activeChainLink;
  const attackResult = pendingAttackResult(frame);
  const power = numeric(attack?.totalPower);
  const defense = numeric(attack?.totalDefense);
  const damage = power !== null ? Math.max(0, power - (defense ?? 0)) : 0;
  const targetHealth = attackResult === "victory" ? opponentHealth : playerHealth;
  if (attackResult && targetHealth !== null && targetHealth > 0 && damage >= targetHealth) {
    return attackResult;
  }

  return "unknown";
}

export function normalizeCompletion(match) {
  if (!isCompleteMatch(match) || match.status === "finished") return match;
  const finalFrame = [...match.frames].reverse().find((frame) => isFinished(frame.indicators || indicators(frame.payload)));
  match.status = "finished";
  match.endedAt = finalFrame?.receivedAt || match.updatedAt;
  match.result = match.summary?.winner ? "finished" : "unknown";
  return match;
}

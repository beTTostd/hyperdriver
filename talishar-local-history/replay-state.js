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
  "action",
  "actionData",
  "pitchValue",
  "restriction",
  "zone",
  "type",
  "sType",
  "facing",
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
  "otherPlayer",
  "playerHealth",
  "playerDeckCount",
  "turnNo",
  "turnPlayer",
  "playerAP",
  "opponentAP",
  "playerPitchCount",
  "opponentPitchCount",
  "havePriority",
  "priorityPlayer",
  "canPassPhase",
];
const SINGLE_CARD_FIELDS = new Set([
  "opponentDeckCard",
  "playerDeckCard",
  "lastPlayedCard",
]);

const DECK_LINK_HOSTS = new Set([
  "fabdb.net",
  "fabbazaar.app",
  "fabmeta.net",
  "fabtcgmeta.com",
  "fabrary.net",
]);

function isScalar(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

const MAX_SAFE_LABEL_LENGTH = 160;
const MAX_SAFE_TOKEN_LENGTH = 256;
const SAFE_TOKEN_PATTERN = /^[\p{L}\p{N}_.:+\-/]+$/u;

function compactToken(value, maxLength = MAX_SAFE_TOKEN_LENGTH) {
  if (!isScalar(value)) return undefined;
  const token = String(value).trim();
  if (!token || token.length > maxLength || !SAFE_TOKEN_PATTERN.test(token)) return undefined;
  return token;
}

function compactLabel(value, maxLength = MAX_SAFE_LABEL_LENGTH) {
  if (!isScalar(value)) return undefined;
  const label = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label ? label.slice(0, maxLength) : undefined;
}

export function normalizeDeckLink(value) {
  if (typeof value !== "string") return undefined;
  const favoriteSeparator = value.lastIndexOf("<fav>");
  const candidate = value.slice(favoriteSeparator < 0 ? 0 : favoriteSeparator + 5).trim();
  if (!candidate || candidate.length > 2_048) return undefined;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !DECK_LINK_HOSTS.has(hostname)
    ) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export const SYNC_ORIGINS = Object.freeze([
  "https://beta.hyperdriver.com.br",
  "https://hyperdriver.com.br",
]);

function compactSyncEntry(value) {
  return compactRecord(value, ["uploadedAt", "username", "replayId"]);
}

function compactSyncError(value) {
  return compactRecord(value, ["at", "message"]);
}

export function replaySyncState(match) {
  const sync = match?.sync && typeof match.sync === "object" && !Array.isArray(match.sync)
    ? match.sync
    : {};
  const targets = {};
  const errors = {};

  for (const origin of SYNC_ORIGINS) {
    const target = compactSyncEntry(sync.targets?.[origin]);
    if (target?.uploadedAt) targets[origin] = target;
    const error = compactSyncError(sync.errors?.[origin]);
    if (error?.message) errors[origin] = error;
  }

  if (sync.uploadedAt && SYNC_ORIGINS.includes(sync.origin) && !targets[sync.origin]) {
    targets[sync.origin] = compactSyncEntry(sync);
  }
  if (match?.syncError?.message && SYNC_ORIGINS.includes(sync.origin) && !errors[sync.origin]) {
    errors[sync.origin] = compactSyncError(match.syncError);
  }

  return { targets, errors };
}

export function normalizeReplaySync(match) {
  if (!match || typeof match !== "object" || Array.isArray(match)) return match;
  match.sync = replaySyncState(match);
  delete match.syncError;
  return match;
}

export function replaySyncProgress(match) {
  const { targets } = replaySyncState(match);
  return {
    synced: SYNC_ORIGINS.filter((origin) => Boolean(targets[origin]?.uploadedAt)).length,
    total: SYNC_ORIGINS.length,
  };
}

export function isReplaySyncedToOrigin(match, origin) {
  return SYNC_ORIGINS.includes(origin) && Boolean(replaySyncState(match).targets[origin]?.uploadedAt);
}

export function markReplaySynced(match, origin, details, uploadedAt = new Date().toISOString()) {
  if (!SYNC_ORIGINS.includes(origin)) return false;
  normalizeReplaySync(match);
  match.sync.targets[origin] = compactSyncEntry({ ...details, uploadedAt });
  delete match.sync.errors[origin];
  return true;
}

export function markReplaySyncError(match, origin, message, at = new Date().toISOString()) {
  if (!SYNC_ORIGINS.includes(origin)) return false;
  normalizeReplaySync(match);
  match.sync.errors[origin] = compactSyncError({ at, message });
  return true;
}

function compactCard(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const card = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "actionDataOverride") {
      const actionData = compactToken(item);
      if (actionData !== undefined) card.actionData = actionData;
      continue;
    }
    if (!CARD_FIELDS_SET.has(key)) continue;
    if (key === "countersMap") {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        card[key] = Object.fromEntries(
          Object.entries(item).filter(([, counter]) => isScalar(counter)),
        );
      }
      continue;
    }
    if (!isScalar(item)) continue;
    if (["cardNumber", "slot", "actionData", "restriction", "zone", "type", "sType", "facing"].includes(key)) {
      const token = compactToken(item);
      if (token !== undefined) card[key] = token;
    } else {
      card[key] = item;
    }
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

function compactButton(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const button = {};
  for (const key of ["mode", "numMode"]) {
    if (isScalar(value[key])) button[key] = value[key];
  }
  for (const key of ["buttonInput", "cardID"]) {
    const token = compactToken(value[key]);
    if (token !== undefined) button[key] = token;
  }
  const caption = compactLabel(value.caption ?? value.prompt);
  if (caption !== undefined) button.caption = caption;
  return Object.keys(button).length ? button : null;
}

function compactButtons(value) {
  return Array.isArray(value)
    ? value.slice(0, 100).map(compactButton).filter(Boolean)
    : [];
}

function compactPlayerPrompt(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const buttons = compactButtons(value.buttons);
  return buttons.length ? { buttons } : null;
}

function compactChoiceOptions(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return values.slice(0, 100).map((option) => compactToken(option)).filter(Boolean);
}

function compactPlayerInputPopUp(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  if (typeof value.active === "boolean") result.active = value.active;

  const buttons = compactButtons(value.buttons);
  if (buttons.length) result.buttons = buttons;

  if (value.popup && typeof value.popup === "object" && !Array.isArray(value.popup)) {
    const popup = {};
    if (typeof value.popup.active === "boolean") popup.active = value.popup.active;
    const id = compactToken(value.popup.id);
    const title = compactLabel(value.popup.title);
    if (id !== undefined) popup.id = id;
    if (title !== undefined) popup.title = title;
    for (const key of ["cards", "topCards", "bottomCards"]) {
      const cards = compactCardList(value.popup[key]).slice(0, 100);
      if (cards.length) popup[key] = cards;
    }
    if (Object.keys(popup).length) result.popup = popup;
  }

  if (Array.isArray(value.multiChooseText)) {
    const options = value.multiChooseText.slice(0, 100).map((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) return null;
      const compacted = {};
      const optionValue = compactToken(option.value);
      const label = compactLabel(option.label);
      if (optionValue !== undefined) compacted.value = optionValue;
      if (label !== undefined) compacted.label = label;
      return Object.keys(compacted).length ? compacted : null;
    }).filter(Boolean);
    if (options.length) result.options = options;
  }

  const choiceOptions = compactChoiceOptions(value.choiceOptions);
  if (choiceOptions.length) result.choiceOptions = choiceOptions;

  if (value.formOptions && typeof value.formOptions === "object" && !Array.isArray(value.formOptions)) {
    const form = {};
    for (const key of ["mode", "maxNo", "minNo"]) {
      if (isScalar(value.formOptions[key])) form[key] = value.formOptions[key];
    }
    const caption = compactLabel(value.formOptions.caption);
    if (caption !== undefined) form.caption = caption;
    if (Object.keys(form).length) result.form = form;
  }

  return Object.keys(result).length ? result : null;
}

function decisionZone(value) {
  const zone = compactToken(value, 40)?.toUpperCase();
  return zone && /^(?:MY|THEIR)?(?:HAND|ARS|ARSENAL|BANISH|CHAR|DISCARD|ITEMS|LAYER|PERM|PITCH|CC|BUTTON|MODAL)$/.test(zone)
    ? zone
    : undefined;
}

/**
 * Defense-in-depth sanitizer for an action already projected by the page bridge.
 * It deliberately has no generic object traversal, so auth/chat/request bodies
 * cannot enter a replay through a forged window message or imported document.
 */
export function compactDecisionChoice(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const action = compactToken(value.action, 40);
  if (action === undefined) return null;
  const result = { action };
  const zone = decisionZone(value.zone);
  const identifier = compactToken(value.identifier);
  if (zone !== undefined) result.zone = zone;
  if (identifier !== undefined) result.identifier = identifier;
  if (Array.isArray(value.identifiers)) {
    const identifiers = [...new Set(
      value.identifiers.slice(0, 100).map((item) => compactToken(item)).filter(Boolean),
    )];
    if (identifiers.length) result.identifiers = identifiers;
  }
  return result;
}

function compactDecisionEvent(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const choice = compactDecisionChoice(value.choice ?? value);
  if (!choice) return null;
  const event = { choice };
  if (isScalar(value.sequence)) event.sequence = value.sequence;
  if (isScalar(value.frameSequence)) event.frameSequence = value.frameSequence;
  if (typeof value.occurredAt === "string" && Number.isFinite(Date.parse(value.occurredAt))) {
    event.occurredAt = value.occurredAt;
  }
  return event;
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
 * Talishar sends chat, account metadata and UI plumbing in every SSE frame.
 * Keep the local player's sanitized deck link so the replay can reference the
 * exact list, while discarding fields that are not needed by the replay.
 */
export function compactReplayPayload(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = {};

  if (value.initialLoad && typeof value.initialLoad === "object" && !Array.isArray(value.initialLoad)) {
    const initialLoad = {};
    if (isScalar(value.initialLoad.gameFormat)) {
      initialLoad.gameFormat = value.initialLoad.gameFormat;
    }
    const deckLink = normalizeDeckLink(value.initialLoad.deckLink);
    if (deckLink) initialLoad.deckLink = deckLink;
    if (Object.keys(initialLoad).length) payload.initialLoad = initialLoad;
  }
  if (Object.prototype.hasOwnProperty.call(value, "turnPhase")) {
    payload.turnPhase = compactTurnPhase(value.turnPhase);
  }
  if (Object.prototype.hasOwnProperty.call(value, "activeChainLink")) {
    payload.activeChainLink = compactChain(value.activeChainLink);
  }
  if (Object.prototype.hasOwnProperty.call(value, "playerPrompt")) {
    const prompt = compactPlayerPrompt(value.playerPrompt);
    if (prompt) payload.playerPrompt = prompt;
  }
  if (Object.prototype.hasOwnProperty.call(value, "playerInputPopUp")) {
    const popup = compactPlayerInputPopUp(value.playerInputPopUp);
    if (popup) payload.playerInputPopUp = popup;
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
  compacted.sync = replaySyncState(match);
  compacted.frames = Array.isArray(match.frames) ? match.frames.map(compactReplayFrame) : [];
  compacted.decisionEvents = Array.isArray(match.decisionEvents)
    ? match.decisionEvents.slice(0, 5_000).map(compactDecisionEvent).filter(Boolean)
    : [];
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

function winnerFromChatLog(value) {
  if (typeof value !== "string") return undefined;
  let winner;
  for (const match of value.matchAll(/Player\s+([12])(?:\s+\([^)]*\))?\s+won!/gi)) {
    winner = match[1];
  }
  if (winner) return winner;

  let concedingPlayer;
  for (const match of value.matchAll(/Player\s+([12])\s+conceded the game/gi)) {
    concedingPlayer = match[1];
  }
  if (!concedingPlayer) return undefined;
  return concedingPlayer === "1" ? "2" : "1";
}

export function indicators(payload) {
  return {
    turn: findFirstByKey(payload, ["turn", "turnno", "turnnumber", "currentturn"]),
    activePlayer: findFirstByKey(payload, ["activeplayer", "currentplayer", "playerturn"]),
    gameOver: findFirstByKey(payload, ["gameover", "gameended", "matchended"]),
    winner: findFirstByKey(payload, ["winner", "winningplayer"])
      ?? winnerFromChatLog(findFirstByKey(payload, ["chatlog"])),
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

function playerNumber(value) {
  if (value === 1 || value === "1") return "1";
  if (value === 2 || value === "2") return "2";
  return null;
}

export function localPlayerNumber(match) {
  const frames = Array.isArray(match?.frames) ? match.frames : [];
  for (const frame of frames) {
    const payload = frame?.payload;
    const otherPlayer = playerNumber(payload?.otherPlayer);
    if (otherPlayer) return otherPlayer === "1" ? "2" : "1";

    for (const key of CARD_ARRAY_FIELDS) {
      if (!key.startsWith("player") || !Array.isArray(payload?.[key])) continue;
      for (const card of payload[key]) {
        const controller = playerNumber(card?.controller);
        if (controller) return controller;
      }
    }
    for (const key of ["playerDeckCard"]) {
      const controller = playerNumber(payload?.[key]?.controller);
      if (controller) return controller;
    }
  }
  return null;
}

function winnerResult(value, localPlayer) {
  const winner = playerNumber(value);
  if (winner && localPlayer) return winner === localPlayer ? "victory" : "defeat";
  if (winner) return null;
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

function pendingAttackResult(frame, localPlayer) {
  const attack = frame?.payload?.activeChainLink;
  const controller = playerNumber(attack?.attackingCard?.controller);
  const power = numeric(attack?.totalPower);
  const defense = numeric(attack?.totalDefense);
  if (!power || !controller || !localPlayer) return null;
  const damage = Math.max(0, power - (defense ?? 0));
  if (damage <= 0) return null;
  return controller === localPlayer ? "victory" : "defeat";
}

export function replayResult(match) {
  const frame = finalFrame(match);
  const localPlayer = localPlayerNumber(match);
  const winner = winnerResult(frame?.indicators?.winner, localPlayer)
    ?? winnerResult(match?.summary?.winner, localPlayer);
  if (winner) return winner;

  const playerHealth = numeric(frame?.payload?.playerHealth);
  const opponentHealth = numeric(frame?.payload?.opponentHealth);
  if (playerHealth !== null && playerHealth <= 0) return "defeat";
  if (opponentHealth !== null && opponentHealth <= 0) return "victory";

  const attack = frame?.payload?.activeChainLink;
  const attackResult = pendingAttackResult(frame, localPlayer);
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

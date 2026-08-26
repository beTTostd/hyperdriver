import { createHash } from "node:crypto";

export const DECISION_ANALYSIS_SCHEMA_VERSION = "1.1.0";
export const DECISION_EVALUATOR_VERSION = "hybrid-rules-1.1.0";
export const DECISION_CARD_CATALOG_VERSION = "talishar-card-identifiers-2026-08-25";
export const DECISION_RULES_VERSION = "fab-comprehensive-rules-2026-08-25";
export const TALISHAR_COMPATIBLE_COMMIT = "4e062d6bfefbe2be1941fb639395624d35af47d4";

const PUBLIC_OPPONENT_ZONES = [
  "opponentDiscard",
  "opponentPitch",
  "opponentBanish",
  "opponentEquipment",
  "opponentArse",
  "opponentAllies",
  "opponentAuras",
  "opponentItems",
  "opponentPermanents",
];

const LOCAL_ACTION_ZONES = [
  ["playerHand", "HAND"],
  ["playerArse", "ARSENAL"],
  ["playerEquipment", "CHAR"],
  ["playerBanish", "BANISH"],
  ["playerDiscard", "DISCARD"],
  ["playerPitch", "PITCH"],
  ["playerItems", "ITEMS"],
  ["playerPermanents", "PERM"],
  ["playerAuras", "PERM"],
  ["playerAllies", "PERM"],
];

const OPERATIONAL_BUTTON_ACTION_CODES = new Set(["10000", "10001"]);
const OPERATIONAL_BUTTON_CAPTION = /^(?:cancel|cancelar|undo(?:\s+block)?|desfazer(?:\s+bloqueio)?)$/i;

const PATTERN_LABELS = Object.freeze({
  "early-blue-pitch": "Pitch de blues cedo demais",
  overblock: "Overblock",
  "lost-arsenal": "Arsenal perdido",
  "weak-arsenal": "Arsenal de baixo impacto",
  "interrupted-line": "Linha interrompida sem necessidade",
  "incompatible-hand": "Mãos incompatíveis com o plano",
  "insufficient-pitch": "Pitch insuficiente",
  "equipment-efficiency": "Equipamento gasto com baixa eficiência",
});

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  return Math.max(0, numberOrNull(value) ?? 0);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function visibleCardId(card) {
  const value = typeof card?.cardNumber === "string" ? card.cardNumber.trim() : "";
  return value && !["CardBack", "NONE00", "blank"].includes(value) ? value : null;
}

function publicOpponentCardId(card) {
  if (typeof card?.facing === "string" && card.facing.toUpperCase() === "DOWN") return null;
  return visibleCardId(card);
}

function cardProjection(card) {
  const identifier = visibleCardId(card);
  if (!identifier) return null;
  const projected = { identifier };
  const pitchValue = numberOrNull(card.pitchValue);
  if (pitchValue !== null) projected.pitchValue = pitchValue;
  if (typeof card.slot === "string" && card.slot) projected.slot = card.slot;
  if (typeof card.controller === "string" || typeof card.controller === "number") {
    projected.controller = String(card.controller);
  }
  return projected;
}

function cardList(value) {
  return Array.isArray(value) ? value : [];
}

function projectedCards(value) {
  return cardList(value).map(cardProjection).filter(Boolean);
}

function projectedPublicOpponentCards(value) {
  return cardList(value)
    .filter((card) => publicOpponentCardId(card))
    .map(cardProjection)
    .filter(Boolean);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function payloadSignature(payload) {
  return stableStringify(payload ?? {});
}

/**
 * Canonicalizes the replay path while preserving the most recent occurrence
 * of a reverted state. A repeated payload means Talishar returned to an older
 * state; frames from the abandoned branch are removed.
 */
export function canonicalDecisionFrames(frames) {
  const canonical = [];
  const signatures = [];
  const positions = new Map();
  for (let originalIndex = 0; originalIndex < (Array.isArray(frames) ? frames.length : 0); originalIndex += 1) {
    const frame = frames[originalIndex];
    if (!frame?.payload || typeof frame.payload !== "object") continue;
    const signature = payloadSignature(frame.payload);
    const previousIndex = positions.get(signature);
    const entry = {
      frame,
      originalIndex,
      frameSequence: numberOrNull(frame.sequence) ?? originalIndex + 1,
    };
    if (previousIndex !== undefined) {
      for (const removed of signatures.splice(previousIndex + 1)) positions.delete(removed);
      canonical.splice(previousIndex + 1);
      canonical[previousIndex] = entry;
      continue;
    }
    positions.set(signature, canonical.length);
    signatures.push(signature);
    canonical.push(entry);
  }
  return canonical;
}

function addSeenCards(payload, seenOpponentCards) {
  for (const zone of PUBLIC_OPPONENT_ZONES) {
    for (const card of cardList(payload?.[zone])) {
      const identifier = publicOpponentCardId(card);
      if (identifier) seenOpponentCards.add(identifier);
    }
  }
  const attacker = visibleCardId(payload?.activeChainLink?.attackingCard);
  if (attacker && String(payload?.activeChainLink?.attackingCard?.controller) === String(payload?.otherPlayer ?? "")) {
    seenOpponentCards.add(attacker);
  }
}

function publicZones(payload) {
  return {
    ownDiscard: projectedCards(payload.playerDiscard),
    ownPitch: projectedCards(payload.playerPitch),
    ownBanish: projectedCards(payload.playerBanish),
    opponentDiscard: projectedPublicOpponentCards(payload.opponentDiscard),
    opponentPitch: projectedPublicOpponentCards(payload.opponentPitch),
    opponentBanish: projectedPublicOpponentCards(payload.opponentBanish),
    opponentPermanents: [
      ...projectedPublicOpponentCards(payload.opponentAllies),
      ...projectedPublicOpponentCards(payload.opponentAuras),
      ...projectedPublicOpponentCards(payload.opponentItems),
      ...projectedPublicOpponentCards(payload.opponentPermanents),
    ],
  };
}

function chainProjection(chain) {
  if (!chain || typeof chain !== "object") return null;
  return {
    attacker: visibleCardId(chain.attackingCard),
    controller: chain.attackingCard?.controller === undefined
      ? null
      : String(chain.attackingCard.controller),
    power: numberOrNull(chain.totalPower),
    defense: numberOrNull(chain.totalDefense),
    goAgain: Boolean(chain.goAgain),
    dominate: Boolean(chain.dominate),
    overpower: Boolean(chain.overpower),
    reactions: projectedCards(chain.reactions),
  };
}

export function knownDecisionState(document, entry, seenOpponentCards = new Set()) {
  void document;
  const payload = entry?.frame?.payload ?? {};
  addSeenCards(payload, seenOpponentCards);
  const otherPlayer = ["1", "2"].includes(String(payload.otherPlayer))
    ? String(payload.otherPlayer)
    : null;
  const currentController = cardList(payload.playerEquipment)
    .map((card) => String(card?.controller))
    .find((controller) => ["1", "2"].includes(controller));
  const localPlayer = otherPlayer
    ? (otherPlayer === "1" ? "2" : "1")
    : currentController ?? "1";
  const ownEquipment = projectedCards(payload.playerEquipment);
  const opponentEquipment = projectedPublicOpponentCards(payload.opponentEquipment);
  const turnPlayer = payload.turnPlayer === undefined ? null : String(payload.turnPlayer);
  const phase = typeof payload.turnPhase?.turnPhase === "string"
    ? payload.turnPhase.turnPhase
    : null;
  const caption = typeof payload.turnPhase?.caption === "string"
    ? payload.turnPhase.caption.slice(0, 160)
    : null;
  return {
    frameSequence: entry.frameSequence,
    frameIndex: entry.originalIndex,
    turn: numberOrNull(payload.turnNo),
    turnPlayer,
    localPlayer,
    isOwnTurn: turnPlayer === localPlayer,
    phase,
    caption,
    hasPriority: typeof payload.havePriority === "boolean" ? payload.havePriority : null,
    priorityPlayer: payload.priorityPlayer === undefined ? null : String(payload.priorityPlayer),
    canPassPhase: Boolean(payload.canPassPhase),
    own: {
      life: numberOrNull(payload.playerHealth),
      actionPoints: numberOrNull(payload.playerAP),
      resources: numberOrNull(payload.playerPitchCount),
      deckCount: numberOrNull(payload.playerDeckCount),
      hand: projectedCards(payload.playerHand),
      arsenal: projectedCards(payload.playerArse),
      equipment: ownEquipment,
    },
    opponent: {
      life: numberOrNull(payload.opponentHealth),
      actionPoints: numberOrNull(payload.opponentAP),
      resources: numberOrNull(payload.opponentPitchCount),
      deckCount: numberOrNull(payload.opponentDeckCount),
      handCount: cardList(payload.opponentHand).length,
      arsenalCount: cardList(payload.opponentArse).length,
      equipment: opponentEquipment,
    },
    publicZones: publicZones(payload),
    chain: chainProjection(payload.activeChainLink),
    seenOpponentCards: [...seenOpponentCards].sort(),
    matchup: {
      hero: ownEquipment.find((card) => card.slot === "Hero")?.identifier ?? null,
      opponentHero: opponentEquipment.find((card) => card.slot === "Hero")?.identifier ?? null,
    },
  };
}

function actionIdentifier(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 256 ? normalized : null;
}

function splitZoneIdentifier(value) {
  const normalized = actionIdentifier(value);
  if (!normalized) return { identifier: null, zone: null };
  const match = normalized.match(/^(?:(MY|THEIR))?(HAND|ARS|ARSENAL|BANISH|CHAR|DISCARD|ITEMS|LAYER|PERM|PITCH|CC)-(.+)$/i);
  if (!match) return { identifier: normalized, zone: null };
  return {
    identifier: match[3],
    zone: `${match[1] ?? ""}${match[2]}`.toUpperCase(),
  };
}

function displayIdentifier(value) {
  if (!value) return "Opção";
  if (/^(?:pass|skip|none|no)$/i.test(value)) return "Passar prioridade/fase";
  return value
    .replace(/_(red|yellow|blue)$/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function actionKey(action) {
  return [action.actionCode, action.zone ?? "", action.input ?? "", action.identifier ?? ""].join(":");
}

function comparableZone(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  const withoutOwner = normalized.replace(/^(?:MY|THEIR)/, "");
  return withoutOwner === "ARS" ? "ARSENAL" : withoutOwner;
}

function actionFromCard(card, zone, index, source = "card") {
  if (!card || (typeof card.action !== "string" && typeof card.action !== "number")) return null;
  if (!String(card.action).trim() || String(card.action).trim() === "0") return null;
  if (typeof card.restriction === "string" && card.restriction.trim()) return null;
  const identifier = visibleCardId(card);
  if (!identifier) return null;
  const action = {
    actionCode: String(card.action),
    zone,
    identifier,
    input: actionIdentifier(card.actionData) ?? String(index),
    label: displayIdentifier(identifier),
    source,
    pitchValue: numberOrNull(card.pitchValue),
    cardType: typeof card.type === "string" ? card.type : null,
  };
  action.key = actionKey(action);
  return action;
}

function actionFromButton(button, source = "button") {
  if (!button || (typeof button.mode !== "string" && typeof button.mode !== "number")) return null;
  const actionCode = String(button.mode).trim();
  const caption = typeof button.caption === "string" ? button.caption.trim() : "";
  if (OPERATIONAL_BUTTON_ACTION_CODES.has(actionCode) || OPERATIONAL_BUTTON_CAPTION.test(caption)) return null;
  const input = actionIdentifier(button.buttonInput ?? button.cardID);
  const split = splitZoneIdentifier(input);
  const identifier = split.identifier ?? `mode-${button.mode}`;
  const action = {
    actionCode,
    zone: split.zone ?? (source === "modal" ? "MODAL" : "BUTTON"),
    identifier,
    input,
    label: typeof button.caption === "string" && button.caption.trim()
      ? button.caption.trim().slice(0, 160)
      : displayIdentifier(identifier),
    source,
    pitchValue: null,
    cardType: null,
  };
  action.key = actionKey(action);
  return action;
}

function modalOptionAction(option, mode) {
  const identifier = actionIdentifier(option?.value ?? option);
  if (!identifier || (typeof mode !== "string" && typeof mode !== "number")) return null;
  const action = {
    actionCode: String(mode),
    zone: "MODAL",
    identifier,
    input: identifier,
    label: typeof option?.label === "string" && option.label.trim()
      ? option.label.trim().slice(0, 160)
      : displayIdentifier(identifier),
    source: "modal",
    pitchValue: null,
    cardType: null,
  };
  action.key = actionKey(action);
  return action;
}

function actionFromModalCard(card, index, mode) {
  if (typeof mode !== "string" && typeof mode !== "number") {
    return actionFromCard(card, "MODAL", index, "modal");
  }
  const identifier = visibleCardId(card);
  const input = actionIdentifier(card?.actionData) ?? String(index);
  if (!identifier) return null;
  const action = {
    actionCode: String(mode),
    zone: "MODAL",
    identifier,
    input,
    label: displayIdentifier(identifier),
    source: "modal",
    pitchValue: numberOrNull(card.pitchValue),
    cardType: typeof card.type === "string" ? card.type : null,
  };
  action.key = actionKey(action);
  return action;
}

export function legalActionsAtFrame(payload) {
  const candidates = [];
  for (const [field, zone] of LOCAL_ACTION_ZONES) {
    cardList(payload?.[field]).forEach((card, index) => {
      const action = actionFromCard(card, zone, index);
      if (action) candidates.push(action);
    });
  }
  for (const button of payload?.playerPrompt?.buttons ?? []) {
    const action = actionFromButton(button);
    if (action) candidates.push(action);
  }
  for (const button of payload?.playerInputPopUp?.buttons ?? []) {
    const action = actionFromButton(button, "modal");
    if (action) candidates.push(action);
  }
  const popup = payload?.playerInputPopUp;
  const modalMode = popup?.form?.mode;
  for (const option of popup?.options ?? []) {
    const action = modalOptionAction(option, modalMode);
    if (action) candidates.push(action);
  }
  for (const field of ["cards", "topCards", "bottomCards"]) {
    cardList(popup?.popup?.[field]).forEach((card, index) => {
      const action = actionFromModalCard(card, index, modalMode);
      if (action) candidates.push(action);
    });
  }
  if (payload?.canPassPhase && !candidates.some((action) => /pass|skip/i.test(`${action.identifier} ${action.label}`))) {
    const pass = {
      actionCode: "pass",
      zone: "BUTTON",
      identifier: "pass",
      input: null,
      label: "Passar prioridade/fase",
      source: "pass",
      pitchValue: null,
      cardType: null,
    };
    pass.key = actionKey(pass);
    candidates.push(pass);
  }
  return [...new Map(candidates.map((action) => [action.key, action])).values()];
}

function normalizedCaption(state) {
  return `${state.phase ?? ""} ${state.caption ?? ""}`.toLowerCase();
}

export function classifyDecision(state, legalActions = []) {
  const caption = normalizedCaption(state);
  if (/pitch|resource|recurso|pay|pagar/.test(caption)) return "pitch";
  if (/arsenal/.test(caption)) return "arsenal";
  if (/reaction|reação|react/.test(caption)) return "reaction";
  if (/instant|instante/.test(caption)) return "instant";
  if (/defen|block|bloque/.test(caption) || String(state.phase).toUpperCase() === "D") return "defense";
  if (legalActions.some((action) => action.source === "modal") || /modal|option|opção/.test(caption)) return "modal";
  return "action";
}

function choiceMatchesAction(choice, action) {
  if (!choice || String(choice.action) !== action.actionCode) return false;
  const identifier = actionIdentifier(choice.identifier);
  if (identifier && ![action.identifier, action.input].includes(identifier)) return false;
  if (choice.zone && action.zone && comparableZone(choice.zone) !== comparableZone(action.zone)) return false;
  return true;
}

function chosenFromChoice(choice, legalActions) {
  const exact = legalActions.filter((action) => choiceMatchesAction(choice, action));
  if (exact.length === 1) return exact[0];
  const sameAction = legalActions.filter((action) => String(choice?.action) === action.actionCode);
  if (!choice?.identifier && sameAction.length === 1) return sameAction[0];
  if (Array.isArray(choice?.identifiers) && choice.identifiers.length) {
    const selected = legalActions.filter((action) => choice.identifiers.some(
      (identifier) => [action.identifier, action.input].includes(actionIdentifier(identifier)),
    ));
    if (selected.length) {
      const composite = {
        actionCode: String(choice.action),
        zone: choice.zone ?? "MODAL",
        identifier: selected.map((action) => action.identifier).join("+"),
        identifiers: selected.map((action) => action.identifier),
        input: null,
        label: selected.map((action) => action.label).join(" + "),
        source: "multi",
        pitchValue: null,
        cardType: null,
      };
      composite.key = actionKey(composite);
      return composite;
    }
  }
  return null;
}

function handFingerprint(state) {
  return fingerprint({
    turn: state.turn,
    cards: state.own.hand
      .map((card) => `${card.identifier}:${card.pitchValue ?? "?"}`)
      .sort(),
  });
}

function observation(entry, state, choice, dataQuality) {
  const legalActions = legalActionsAtFrame(entry.frame.payload);
  const chosenAction = choice ? chosenFromChoice(choice, legalActions) : null;
  const kind = classifyDecision(state, legalActions);
  const fingerprintState = { ...state };
  delete fingerprintState.frameSequence;
  delete fingerprintState.frameIndex;
  const stateFingerprint = fingerprint(fingerprintState);
  return {
    frameSequence: entry.frameSequence,
    frameIndex: entry.originalIndex,
    turn: state.turn,
    kind,
    state,
    legalActions,
    chosenAction,
    capturedChoice: choice ?? null,
    stateFingerprint,
    handFingerprint: handFingerprint(state),
    dataQuality: chosenAction && legalActions.length >= 2 ? dataQuality : "insufficient",
  };
}

function entryAtSequence(entries, sequence) {
  return entries.find((entry) => entry.frameSequence === sequence) ?? null;
}

function multisetRemoved(before, after) {
  const remaining = new Map();
  for (const card of projectedCards(after)) {
    remaining.set(card.identifier, (remaining.get(card.identifier) ?? 0) + 1);
  }
  const removed = [];
  for (const card of projectedCards(before)) {
    const count = remaining.get(card.identifier) ?? 0;
    if (count > 0) remaining.set(card.identifier, count - 1);
    else removed.push(card.identifier);
  }
  return removed;
}

function includesCard(value, identifier) {
  return projectedCards(value).some((card) => card.identifier === identifier);
}

function inferChoice(current, next, legalActions) {
  const removed = multisetRemoved(current.playerHand, next.playerHand);
  if (removed.length !== 1) return null;
  const identifier = removed[0];
  const candidates = legalActions.filter((action) => action.identifier === identifier);
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  const defenseIncreased = positiveNumber(next.activeChainLink?.totalDefense)
    > positiveNumber(current.activeChainLink?.totalDefense);
  const safelyObserved = includesCard(next.playerPitch, identifier)
    || includesCard(next.playerArse, identifier)
    || visibleCardId(next.lastPlayedCard) === identifier
    || visibleCardId(next.activeChainLink?.attackingCard) === identifier
    || (defenseIncreased && !includesCard(next.playerHand, identifier));
  return safelyObserved
    ? { action: candidate.actionCode, zone: candidate.zone, identifier: candidate.input ?? identifier }
    : null;
}

export function extractDecisionObservations(document) {
  const entries = canonicalDecisionFrames(document?.match?.frames ?? []);
  if (!entries.length) return [];
  const stateByEntry = new Map();
  const seen = new Set();
  for (const entry of entries) {
    const state = knownDecisionState(document, entry, seen);
    stateByEntry.set(entry, { state });
  }

  const explicitByFingerprint = new Map();
  for (const event of document?.match?.decisionEvents ?? []) {
    const frameSequence = numberOrNull(event?.frameSequence);
    if (frameSequence === null) continue;
    const entry = entryAtSequence(entries, frameSequence);
    if (!entry || !event?.choice) continue;
    const known = stateByEntry.get(entry);
    const candidate = observation(entry, known.state, event.choice, "captured");
    explicitByFingerprint.set(candidate.stateFingerprint, candidate);
  }

  const inferredByFingerprint = new Map();
  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index];
    const next = entries[index + 1];
    const known = stateByEntry.get(entry);
    const legalActions = legalActionsAtFrame(entry.frame.payload);
    if (legalActions.length < 2) continue;
    const choice = inferChoice(entry.frame.payload, next.frame.payload, legalActions);
    if (!choice) continue;
    const candidate = observation(entry, known.state, choice, "inferred");
    if (!explicitByFingerprint.has(candidate.stateFingerprint)) {
      inferredByFingerprint.set(candidate.stateFingerprint, candidate);
    }
  }

  return [...explicitByFingerprint.values(), ...inferredByFingerprint.values()]
    .sort((left, right) => left.frameSequence - right.frameSequence)
    .map((item, index) => ({ ...item, ordinal: index + 1 }));
}

function isPass(action) {
  return action?.source === "pass" || /^(?:pass|skip|none|no)$/i.test(action?.identifier ?? "") || /passar|pass|skip/i.test(action?.label ?? "");
}

function baseWinProbability(state) {
  const ownLife = numberOrNull(state.own.life) ?? 20;
  const opponentLife = numberOrNull(state.opponent.life) ?? 20;
  const ownCards = state.own.hand.length + state.own.arsenal.length;
  const opponentCards = state.opponent.handCount + state.opponent.arsenalCount;
  const lifeTerm = (ownLife - opponentLife) * 0.075;
  const cardTerm = (ownCards - opponentCards) * 0.12;
  const deckTerm = ((numberOrNull(state.own.deckCount) ?? 0) - (numberOrNull(state.opponent.deckCount) ?? 0)) * 0.008;
  return 1 / (1 + Math.exp(-(lifeTerm + cardTerm + deckTerm)));
}

function handPotential(state, bestUtility) {
  const hand = state.own.hand;
  const pitchValues = hand.map((card) => numberOrNull(card.pitchValue)).filter((value) => value !== null);
  const hasBlue = pitchValues.some((value) => value === 3);
  const hasRed = pitchValues.some((value) => value === 1);
  const balance = hasBlue && hasRed ? 7 : pitchValues.length && !hasBlue ? -4 : 0;
  return round(clamp(34 + hand.length * 8 + state.own.arsenal.length * 4 + balance + bestUtility * 4, 0, 100), 1);
}

function emptyDecomposition() {
  return {
    expectedDamage: 0,
    lifePreserved: 0,
    cardsConsumed: 0,
    wastedPitch: 0,
    arsenalQuality: 0,
    equipmentSpent: 0,
    chainContinuity: 0,
    firstTurnCardsReplaced: 0,
  };
}

function actionHeuristic(action, state, kind) {
  const decomposition = emptyDecomposition();
  const pass = isPass(action);
  const consumesCard = !pass && ["card", "multi"].includes(action.source);
  decomposition.cardsConsumed = consumesCard ? (action.identifiers?.length ?? 1) : 0;
  // Comprehensive Rules 4.4.3f: at the end of the first turn, every player
  // draws up to intellect. A card spent from hand on T0 therefore does not
  // carry the normal next-hand card-count penalty.
  const firstTurnHandRefill = numberOrNull(state.turn) === 0
    && comparableZone(action.zone) === "HAND";
  decomposition.firstTurnCardsReplaced = firstTurnHandRefill
    ? decomposition.cardsConsumed
    : 0;
  const netCardsConsumed = decomposition.cardsConsumed - decomposition.firstTurnCardsReplaced;
  let utility = 0;

  if (kind === "defense") {
    const incoming = Math.max(0, positiveNumber(state.chain?.power) - positiveNumber(state.chain?.defense));
    const assumedBlock = pass ? 0 : Math.min(incoming || 3, action.zone === "CHAR" ? 2 : 3);
    decomposition.lifePreserved = assumedBlock;
    decomposition.equipmentSpent = !pass && action.zone === "CHAR" ? 1 : 0;
    const ownLife = numberOrNull(state.own.life) ?? 20;
    const urgency = ownLife <= incoming ? 2.8 : ownLife <= 10 ? 1.55 : 0.9;
    utility = assumedBlock * urgency - netCardsConsumed * 1.7 - decomposition.equipmentSpent * 0.65;
  } else if (kind === "pitch") {
    const gain = pass ? 0 : clamp(numberOrNull(action.pitchValue) ?? 1, 0, 3);
    const currentResources = positiveNumber(state.own.resources);
    const usefulResources = Math.max(0, 3 - currentResources);
    decomposition.wastedPitch = Math.max(0, gain - usefulResources);
    utility = Math.min(gain, usefulResources) * 1.25 - decomposition.wastedPitch * 1.15 - netCardsConsumed * 0.45;
  } else if (kind === "arsenal") {
    const pitch = numberOrNull(action.pitchValue);
    decomposition.arsenalQuality = pass ? 0 : pitch === 1 ? 3 : pitch === 2 ? 2 : pitch === 3 ? 1 : 1.75;
    utility = decomposition.arsenalQuality - netCardsConsumed * 0.4;
  } else if (kind === "modal") {
    utility = 0;
  } else {
    const pitch = numberOrNull(action.pitchValue);
    const damage = pass ? 0 : pitch === 1 ? 4 : pitch === 2 ? 3.2 : pitch === 3 ? 2.5 : 3;
    decomposition.expectedDamage = kind === "reaction" ? round(damage * 0.55) : damage;
    decomposition.chainContinuity = pass ? 0 : 1;
    utility = decomposition.expectedDamage * (kind === "reaction" ? 0.72 : 0.82)
      + decomposition.chainContinuity * 1.1
      - netCardsConsumed * 0.65;
    if (kind === "instant") utility += pass ? 0 : 0.35;
  }

  const probability = clamp(baseWinProbability(state) + utility * 0.015, 0.03, 0.97);
  return {
    ...action,
    utility: round(utility, 3),
    estimatedWinProbability: round(probability * 100, 2),
    decomposition,
  };
}

function confidenceFor(observation, scored) {
  if (observation.dataQuality === "insufficient" || observation.kind === "modal") return "low";
  const spread = (scored[0]?.estimatedWinProbability ?? 0) - (scored.at(-1)?.estimatedWinProbability ?? 0);
  const incoming = Math.max(0, positiveNumber(observation.state.chain?.power) - positiveNumber(observation.state.chain?.defense));
  const lethalDefense = observation.kind === "defense"
    && incoming >= positiveNumber(observation.state.own.life)
    && scored.some((action) => action.decomposition.lifePreserved > 0);
  if (observation.dataQuality === "captured" && lethalDefense && spread >= 3) return "high";
  if (spread >= 1.5 && scored.length >= 2) return "medium";
  return "low";
}

function improvementTags(observation, chosen, best) {
  const tags = [];
  const state = observation.state;
  if (observation.kind === "pitch" && chosen.pitchValue === 3 && chosen.decomposition.wastedPitch > 0) tags.push("early-blue-pitch");
  if (observation.kind === "pitch" && (chosen.pitchValue ?? 0) < (best.pitchValue ?? 0)) tags.push("insufficient-pitch");
  if (observation.kind === "defense") {
    const power = positiveNumber(state.chain?.power);
    const defense = positiveNumber(state.chain?.defense);
    if (chosen.decomposition.lifePreserved > Math.max(0, power - defense)) tags.push("overblock");
    if (chosen.decomposition.equipmentSpent && best.decomposition.equipmentSpent < chosen.decomposition.equipmentSpent) tags.push("equipment-efficiency");
  }
  if (observation.kind === "arsenal" && isPass(chosen) && !state.own.arsenal.length) tags.push("lost-arsenal");
  if (observation.kind === "arsenal" && chosen.pitchValue === 3 && best.pitchValue !== 3) tags.push("weak-arsenal");
  if (["action", "reaction", "instant"].includes(observation.kind) && isPass(chosen) && !isPass(best)) tags.push("interrupted-line");
  if (state.own.hand.length >= 3 && observation.legalActions.filter((action) => !isPass(action)).length === 0) tags.push("incompatible-hand");
  return [...new Set(tags)];
}

function explanationFor(observation, chosen, best, regretPp, confidence) {
  if (confidence === "low") {
    return "As alternativas foram registradas, mas a cobertura ainda não permite recomendar uma melhoria com segurança.";
  }
  if (regretPp <= 1.5) {
    if (chosen.decomposition.firstTurnCardsReplaced > 0) {
      return "No primeiro turno, ambos os jogadores compram até o intelecto no fim. A carta usada nesta decisão será reposta, então ela não recebeu a penalidade normal de reduzir a próxima mão.";
    }
    return `A linha executada preservou praticamente todo o valor encontrado para esta decisão de ${decisionKindLabel(observation.kind).toLowerCase()}.`;
  }
  const reason = best.decomposition.firstTurnCardsReplaced > 0 && observation.kind === "defense"
    ? "aproveita a reposição das duas mãos no primeiro turno para preservar vida sem reduzir a próxima mão"
    : observation.kind === "defense"
      ? "equilibra vida preservada e cartas consumidas"
    : observation.kind === "pitch"
      ? "gera os recursos necessários com menos pitch desperdiçado"
      : observation.kind === "arsenal"
        ? "preserva uma carta de maior impacto para o próximo ciclo"
        : "mantém mais dano esperado e continuidade da cadeia";
  return `${best.label} foi a melhor linha encontrada porque ${reason}; a diferença estimada para ${chosen.label} é de ${regretPp.toFixed(1)} p.p. de vitória.`;
}

function decisionKindLabel(kind) {
  const labels = {
    action: "Ação",
    defense: "Defesa",
    pitch: "Pitch",
    reaction: "Reação",
    arsenal: "Arsenal",
    instant: "Instant",
    modal: "Escolha modal",
  };
  return labels[kind] ?? "Decisão";
}

function markerFor(regretPp, confidence) {
  if (confidence === "low") return null;
  if (regretPp <= 1.5) return "good";
  if (regretPp < 5) return "opportunity";
  return "high_impact_error";
}

export function analyzeDecisionObservation(observation) {
  if (observation.dataQuality === "insufficient" || !observation.chosenAction || observation.legalActions.length < 2) return null;
  const scored = observation.legalActions
    .map((action) => actionHeuristic(action, observation.state, observation.kind))
    .sort((left, right) => right.estimatedWinProbability - left.estimatedWinProbability || left.key.localeCompare(right.key));
  let chosen = scored.find((action) => action.key === observation.chosenAction.key);
  if (!chosen && observation.chosenAction.source === "multi") {
    chosen = actionHeuristic(observation.chosenAction, observation.state, observation.kind);
  }
  if (!chosen) return null;
  const best = scored[0];
  const regretPp = round(Math.max(0, best.estimatedWinProbability - chosen.estimatedWinProbability), 2);
  const confidence = confidenceFor(observation, scored);
  const tags = confidence === "low" ? [] : improvementTags(observation, chosen, best);
  const potential = handPotential(observation.state, best.utility);
  const executionQuality = round(clamp(100 - regretPp * 8, 0, 100), 1);
  return {
    observationOrdinal: observation.ordinal,
    stateFingerprint: observation.stateFingerprint,
    handFingerprint: observation.handFingerprint,
    frameSequence: observation.frameSequence,
    frameIndex: observation.frameIndex,
    turn: observation.turn,
    decisionKind: observation.kind,
    decisionLabel: decisionKindLabel(observation.kind),
    handPotential: potential,
    executionQuality,
    chosenAction: chosen,
    chosenActionValue: chosen.estimatedWinProbability,
    bestAction: best,
    bestActionValue: best.estimatedWinProbability,
    alternatives: scored.filter((action) => action.key !== chosen.key && action.key !== best.key).slice(0, 2),
    regretPp,
    confidence,
    marker: markerFor(regretPp, confidence),
    explanation: explanationFor(observation, chosen, best, regretPp, confidence),
    improvementTags: tags,
    evidence: observation.dataQuality === "captured" ? "captured_decision_transparent_rules" : "safely_inferred_observational",
  };
}

function lowerConfidenceBound(values) {
  if (values.length < 3) return Number.NEGATIVE_INFINITY;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return mean - 1.96 * Math.sqrt(variance / values.length);
}

function summaryFromAnalyses(analyses) {
  const trusted = analyses.filter((analysis) => analysis.confidence !== "low");
  const tagValues = new Map();
  for (const analysis of trusted) {
    for (const tag of analysis.improvementTags) {
      const values = tagValues.get(tag) ?? [];
      values.push(analysis.regretPp);
      tagValues.set(tag, values);
    }
  }
  const controllablePatterns = [...tagValues.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([tag, values]) => ({
      tag,
      label: PATTERN_LABELS[tag] ?? tag,
      occurrences: values.length,
      averageRegretPp: round(values.reduce((sum, value) => sum + value, 0) / values.length, 2),
    }))
    .sort((left, right) => right.occurrences - left.occurrences || right.averageRegretPp - left.averageRegretPp)
    .slice(0, 3);
  const deckSignals = [...tagValues.entries()]
    .filter(([, values]) => values.length >= 3 && lowerConfidenceBound(values) > 0)
    .map(([tag, values]) => ({
      tag,
      label: PATTERN_LABELS[tag] ?? tag,
      occurrences: values.length,
      confidenceIntervalExcludesNeutral: true,
    }));
  const average = (key) => trusted.length
    ? round(trusted.reduce((sum, analysis) => sum + analysis[key], 0) / trusted.length, 1)
    : null;
  return {
    evaluatedDecisions: trusted.length,
    lowConfidenceDecisions: analyses.length - trusted.length,
    averageHandPotential: average("handPotential"),
    averageExecutionQuality: average("executionQuality"),
    varianceLimitedHands: trusted.filter((analysis) => analysis.handPotential < 45 && analysis.executionQuality >= 80).length,
    executionBelowPotential: trusted.filter((analysis) => analysis.regretPp >= 2).length,
    controllablePatterns,
    deckSignals,
    deckRecommendations: [],
  };
}

export function analysisVersions(overrides = {}) {
  return {
    analysisSchema: overrides.analysisSchema ?? DECISION_ANALYSIS_SCHEMA_VERSION,
    replaySchema: overrides.replaySchema ?? "unknown",
    evaluator: overrides.evaluator ?? DECISION_EVALUATOR_VERSION,
    cardCatalog: overrides.cardCatalog ?? DECISION_CARD_CATALOG_VERSION,
    rules: overrides.rules ?? DECISION_RULES_VERSION,
    talisharCommit: overrides.talisharCommit ?? TALISHAR_COMPATIBLE_COMMIT,
  };
}

export function analyzeReplayDecisions(document, options = {}) {
  const observations = extractDecisionObservations(document);
  const analyses = observations.map(analyzeDecisionObservation).filter(Boolean);
  const summary = summaryFromAnalyses(analyses);
  return {
    status: summary.evaluatedDecisions > 0 ? "ready" : "insufficient_data",
    versions: analysisVersions({ ...options, replaySchema: document?.schemaVersion ?? "unknown" }),
    observations,
    analyses,
    summary,
    methodology: {
      primaryObjective: "estimated_win_probability",
      optimizationLabel: "melhor linha encontrada",
      usesFinalResult: false,
      collectiveEvidenceUsed: false,
      simulatorUsed: false,
      note: "Primeira fase baseada em regras transparentes; decisões sem cobertura suficiente recebem baixa confiança e não geram recomendação.",
    },
  };
}

export function publicDecisionDatasetExample(observation, metadata = {}) {
  return {
    schemaVersion: DECISION_ANALYSIS_SCHEMA_VERSION,
    stateFingerprint: observation.stateFingerprint,
    handFingerprint: observation.handFingerprint,
    decisionKind: observation.kind,
    hero: observation.state.matchup.hero,
    opponentHero: observation.state.matchup.opponentHero,
    gameMode: typeof metadata.gameMode === "string" ? metadata.gameMode : null,
    state: observation.state,
    legalActions: observation.legalActions,
    chosenAction: observation.chosenAction,
    dataQuality: observation.dataQuality,
    observational: true,
  };
}

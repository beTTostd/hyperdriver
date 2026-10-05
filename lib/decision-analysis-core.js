import { createHash } from "node:crypto";
import { searchDecisionLines, DECISION_TURN_ENGINE_VERSION, DEFAULT_TURN_SEARCH_BUDGET } from "./decision-turn-search.js";
import { createOpponentKnowledge, observeOpponentKnowledge } from "./decision-opponent-knowledge.js";
import { searchInformationSet, INFORMATION_SEARCH_VERSION } from "./decision-information-search.js";
import { OPPONENT_MODEL_VERSION } from "./decision-opponent-model.js";
import { learningDiagnostics, DECISION_LEARNING_VERSION } from "./decision-learning.js";

export const DECISION_ANALYSIS_SCHEMA_VERSION = "5.0.0";
export const DECISION_EVALUATOR_VERSION = "bounded-turn-with-learning-shadow-5.0.0";
import { decisionCardProfile, DECISION_CARD_CATALOG_VERSION } from "./decision-card-catalog.js";
export { DECISION_CARD_CATALOG_VERSION };
export const DECISION_RULES_VERSION = "fab-cr-action-pitch-go-again-reviewed-2026-09-30";
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

function cardProjection(card, index = 0) {
  const identifier = visibleCardId(card);
  if (!identifier) return null;
  const projected = { identifier, instanceIndex: index };
  if (typeof card.actionData === "string" || typeof card.actionData === "number") projected.capturedInput = String(card.actionData);
  if (typeof card.restriction === "string" && card.restriction.trim()) projected.restricted = true;
  if (card.isBroken || card.onChain) projected.unavailable = true;
  const pitchValue = numberOrNull(card.pitchValue);
  if (pitchValue !== null) projected.pitchValue = pitchValue;
  if (card.countersMap && Object.values(card.countersMap).some((value) => numberOrNull(value) !== 0)) projected.hasModifiers = true;
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
  const attacker = publicOpponentCardId(payload?.activeChainLink?.attackingCard);
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

function chainProjection(chain, otherPlayer) {
  if (!chain || typeof chain !== "object") return null;
  return {
    attacker: String(chain.attackingCard?.controller) === String(otherPlayer)
      ? publicOpponentCardId(chain.attackingCard)
      : visibleCardId(chain.attackingCard),
    controller: chain.attackingCard?.controller === undefined
      ? null
      : String(chain.attackingCard.controller),
    power: numberOrNull(chain.totalPower),
    defense: numberOrNull(chain.totalDefense),
    goAgain: Boolean(chain.goAgain),
    dominate: Boolean(chain.dominate),
    overpower: Boolean(chain.overpower),
    reactions: projectedCards(cardList(chain.reactions).filter((card) =>
      String(card.controller) !== String(otherPlayer) || publicOpponentCardId(card))),
  };
}

export function knownDecisionState(document, entry, seenOpponentCards = new Set(), opponentKnowledge = createOpponentKnowledge()) {
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
  const state = {
    observedAt: Number.isFinite(Date.parse(entry.frame.receivedAt)) ? Date.parse(entry.frame.receivedAt) : null,
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
      handCountKnown: Array.isArray(payload.opponentHand),
      arsenalCount: cardList(payload.opponentArse).length,
      arsenalCountKnown: Array.isArray(payload.opponentArse),
      equipment: opponentEquipment,
    },
    publicZones: publicZones(payload),
    chain: chainProjection(payload.activeChainLink, otherPlayer),
    seenOpponentCards: [...seenOpponentCards].sort(),
    opponentVisibleCardCounts: Object.fromEntries(
      PUBLIC_OPPONENT_ZONES.flatMap((zone) => projectedPublicOpponentCards(payload[zone]))
        .reduce((counts, card) => counts.set(card.identifier, (counts.get(card.identifier) ?? 0) + 1), new Map()),
    ),
    paymentCost: numberOrNull(payload.playerPitchCost),
    unsupportedPublicEffects: [
      ...cardList(payload.playerAuras), ...cardList(payload.playerItems),
      ...cardList(payload.playerPermanents), ...cardList(payload.playerAllies),
      ...cardList(payload.opponentAllies), ...cardList(payload.opponentAuras),
      ...cardList(payload.opponentItems), ...cardList(payload.opponentPermanents),
    ].length > 0,
    matchup: {
      hero: ownEquipment.find((card) => card.slot === "Hero")?.identifier ?? null,
      opponentHero: opponentEquipment.find((card) => card.slot === "Hero")?.identifier ?? null,
    },
  };
  state.opponentKnowledge = observeOpponentKnowledge(opponentKnowledge, state, payload);
  return state;
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

function compositeAction(selected) {
  const members = [...selected].sort((left, right) => left.key.localeCompare(right.key));
  return {
    key: `multi:${members.map((action) => action.key).join("|")}`,
    actionCode: members[0].actionCode,
    zone: members[0].zone,
    identifier: members.map((action) => action.identifier).join("+"),
    identifiers: members.map((action) => action.identifier),
    members,
    input: null,
    label: members.map((action) => action.label).join(" + "),
    source: "multi",
    pitchValue: null,
    cardType: null,
  };
}

function chosenFromChoice(choice, legalActions) {
  if (Array.isArray(choice?.identifiers) && choice.identifiers.length) {
    const selected = [];
    for (const identifier of choice.identifiers) {
      const matches = legalActions.filter((action) => choiceMatchesAction({
        action: choice.action, zone: choice.zone, identifier,
      }, action));
      // Reject incomplete, repeated or ambiguous selections (including duplicate names).
      if (matches.length !== 1 || selected.includes(matches[0])) return null;
      selected.push(matches[0]);
    }
    return selected.length === 1 ? selected[0] : compositeAction(selected);
  }
  const exact = legalActions.filter((action) => choiceMatchesAction(choice, action));
  return exact.length === 1 ? exact[0] : null;
}

// Compare like-for-like compound defense selections. No assumption that a
// checkbox used for an arbitrary modal choice has the semantics of blocking.
function decisionCandidates(observation) {
  const actions = observation.legalActions.slice(0, 255);
  const chosen = observation.chosenAction;
  let budgetExhausted = observation.legalActions.length > 255;
  if (chosen?.source === "multi" && observation.kind === "defense") {
    const members = actions.filter((action) => action.actionCode === chosen.actionCode
      && comparableZone(action.zone) === comparableZone(chosen.zone));
    if (members.length > 8 || observation.state.chain?.overpower) {
      budgetExhausted = true;
    } else {
      const visit = (index, selected) => {
        if (selected.length === chosen.members.length) {
          if (!observation.state.chain?.dominate || selected.filter((action) => comparableZone(action.zone) === "HAND").length <= 1) {
            actions.push(compositeAction(selected));
          }
          return;
        }
        for (let next = index; next < members.length; next += 1) visit(next + 1, [...selected, members[next]]);
      };
      visit(0, []);
    }
  }
  if (chosen) actions.push(chosen);
  const unique = [...new Map(actions.map((action) => [action.key, action])).values()];
  if (unique.length > 256) budgetExhausted = true;
  const bounded = unique.filter((action) => action.key !== chosen?.key).slice(0, 255);
  if (chosen) bounded.push(chosen);
  return { actions: bounded, budgetExhausted };
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
  const opponentKnowledge = createOpponentKnowledge();
  for (const entry of entries) {
    const state = knownDecisionState(document, entry, seen, opponentKnowledge);
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
  decomposition.rawBlock = 0;
  decomposition.overblock = 0;
  decomposition.resourcesGenerated = 0;
  const members = action.members ?? [action];
  const reasons = new Set();
  const pass = isPass(action);
  const profiles = members.map((member) => decisionCardProfile(member.identifier));
  const cards = [...state.own.hand, ...state.own.arsenal, ...state.own.equipment];
  for (const member of members) {
    if (!isPass(member) && !decisionCardProfile(member.identifier)) reasons.add("card_not_in_catalog");
    if (cards.some((card) => card.identifier === member.identifier && card.hasModifiers)) reasons.add("unsupported_modifier");
  }
  decomposition.cardsConsumed = members.filter((member) => !isPass(member)
    && comparableZone(member.zone) === "HAND").length;
  const firstTurnHandRefill = numberOrNull(state.turn) === 0;
  decomposition.firstTurnCardsReplaced = firstTurnHandRefill ? decomposition.cardsConsumed : 0;
  const netCardsConsumed = decomposition.cardsConsumed - decomposition.firstTurnCardsReplaced;
  let utility = 0;
  if (kind === "defense") {
    if (numberOrNull(state.chain?.power) === null || numberOrNull(state.chain?.defense) === null) reasons.add("missing_combat_values");
    if (!decisionCardProfile(state.chain?.attacker)) reasons.add("unsupported_attacker_effects");
    if (state.chain?.reactions?.length) reasons.add("unsupported_reactions");
    if (state.chain?.overpower) reasons.add("unsupported_combat_restriction");
    if (state.chain?.dominate && members.filter((member) => !isPass(member) && comparableZone(member.zone) === "HAND").length > 1) reasons.add("illegal_dominate_selection");
    const incoming = Math.max(0, positiveNumber(state.chain?.power) - positiveNumber(state.chain?.defense));
    decomposition.rawBlock = pass ? 0 : profiles.reduce((sum, profile) => sum + (profile?.defense ?? 0), 0);
    decomposition.lifePreserved = Math.min(incoming, decomposition.rawBlock);
    decomposition.overblock = Math.max(0, decomposition.rawBlock - incoming);
    decomposition.equipmentSpent = members.filter((member) => !isPass(member)
      && comparableZone(member.zone) === "CHAR" && !decisionCardProfile(member.identifier)).length;
    const ownLife = numberOrNull(state.own.life);
    if (ownLife === null) reasons.add("missing_life");
    const urgency = ownLife !== null && ownLife <= incoming ? 2.8 : ownLife !== null && ownLife <= 10 ? 1.55 : 0.9;
    utility = decomposition.lifePreserved * urgency - netCardsConsumed * 1.7 - decomposition.equipmentSpent * 0.65;
  } else if (kind === "pitch") {
    const gain = pass ? 0 : members.reduce((sum, _member, index) => sum + (profiles[index]?.pitch ?? 0), 0);
    decomposition.resourcesGenerated = gain;
    const cost = numberOrNull(state.paymentCost);
    const resources = numberOrNull(state.own.resources);
    if (cost === null || resources === null) reasons.add("unknown_payment_cost");
    const needed = cost === null || resources === null ? null : Math.max(0, cost - resources);
    decomposition.wastedPitch = needed === null ? 0 : Math.max(0, gain - needed);
    utility = needed === null ? 0 : Math.min(gain, needed) * 1.25 - decomposition.wastedPitch * 1.15 - netCardsConsumed * 0.45;
  } else if (kind === "action") {
    if (profiles.some((profile) => profile?.effects.length)) reasons.add("effects_require_turn_search");
    if (!state.isOwnTurn || numberOrNull(state.own.actionPoints) === null || state.own.actionPoints < 1) reasons.add("missing_action_point");
    if (members.length > 1) reasons.add("unsupported_action_sequence");
    if (numberOrNull(state.own.resources) === null) reasons.add("unknown_resources");
    for (const profile of profiles) {
      if (profile && profile.cost > positiveNumber(state.own.resources)) reasons.add("payment_sequence_not_evaluated");
    }
    decomposition.expectedDamage = pass ? 0 : profiles.reduce((sum, profile) => sum + (profile?.attack ?? 0), 0);
    // Printed power is a heuristic input, not simulated damage or a continuation.
    utility = decomposition.expectedDamage * 0.82 - netCardsConsumed * 0.65;
  } else {
    reasons.add(`unsupported_${kind}_effects`);
  }
  if (state.unsupportedPublicEffects) reasons.add("unsupported_public_effects");
  const uncertaintyReasons = [...reasons].sort();
  return {
    ...action,
    utility: round(utility, 3),
    heuristicScore: round(utility, 3),
    scoreUnit: "heuristic_points",
    decomposition,
    coverage: {
      supported: uncertaintyReasons.length === 0,
      cards: members.filter((member) => !isPass(member)).map((member) => ({
        identifier: member.identifier,
        profile: decisionCardProfile(member.identifier),
      })),
      uncertaintyReasons,
    },
  };
}

function confidenceFor(observation, scored, budgetExhausted) {
  // A score gap cannot establish confidence. No high confidence until the
  // independent reviewer benchmark meets the release criterion.
  if (observation.dataQuality !== "captured" || budgetExhausted
    || scored.some((action) => !action.coverage.supported)) return "low";
  return "medium";
}

function improvementTags(observation, chosen, best) {
  const tags = [];
  const state = observation.state;
  if (observation.kind === "pitch" && chosen.decomposition.resourcesGenerated >= 3 && chosen.decomposition.wastedPitch > 0) tags.push("early-blue-pitch");
  if (observation.kind === "pitch" && chosen.decomposition.resourcesGenerated < Math.max(0, positiveNumber(state.paymentCost) - positiveNumber(state.own.resources)) && best.decomposition.resourcesGenerated > chosen.decomposition.resourcesGenerated) tags.push("insufficient-pitch");
  if (observation.kind === "defense") {
    if ((chosen.rootDecomposition ?? chosen.decomposition).overblock > 0) tags.push("overblock");
    if ((chosen.rootDecomposition ?? chosen.decomposition).equipmentSpent && (best.rootDecomposition ?? best.decomposition).equipmentSpent < (chosen.rootDecomposition ?? chosen.decomposition).equipmentSpent) tags.push("equipment-efficiency");
  }
  if (observation.kind === "arsenal" && isPass(chosen) && !state.own.arsenal.length && best.decomposition.arsenalQuality > 0) tags.push("lost-arsenal");
  if (observation.kind === "arsenal" && !isPass(chosen) && chosen.decomposition.arsenalQuality < best.decomposition.arsenalQuality) tags.push("weak-arsenal");
  if (["action", "reaction", "instant"].includes(observation.kind) && isPass(chosen) && !isPass(best)) tags.push("interrupted-line");
  if (state.own.hand.length >= 3 && observation.legalActions.filter((action) => !isPass(action)).length === 0) tags.push("incompatible-hand");
  return [...new Set(tags)];
}

function explanationFor(observation, chosen, best, regretScore, confidence) {
  if (confidence === "low") {
    return "As alternativas foram registradas, mas a cobertura ainda não permite recomendar uma melhoria com segurança.";
  }
  if (regretScore <= 1.5) {
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
        : "compara poder impresso e cartas consumidas, sem simular o dano ou a continuação";
  return `${best.label} teve a maior pontuação porque ${reason}; diferença de ${regretScore.toFixed(2)} pontos heurísticos para ${chosen.label}. Bloqueio bruto: ${chosen.decomposition.rawBlock}; vida preservada: ${chosen.decomposition.lifePreserved}; excesso: ${chosen.decomposition.overblock}; cartas consumidas: ${chosen.decomposition.cardsConsumed}; pitch excedente: ${chosen.decomposition.wastedPitch}. Alternativa: poder impresso ${best.decomposition.expectedDamage}; vida preservada ${best.decomposition.lifePreserved}; cartas ${best.decomposition.cardsConsumed}; pitch excedente ${best.decomposition.wastedPitch}.`;
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

function markerFor(regretScore, confidence) {
  if (confidence === "low") return null;
  if (regretScore <= 1.5) return "good";
  if (regretScore < 5) return "opportunity";
  return "high_impact_error";
}

export function analyzeDecisionObservation(observation, searchOptions = {}) {
  if (observation.dataQuality === "insufficient" || !observation.chosenAction || observation.legalActions.length < 2) return null;
  const candidates = decisionCandidates(observation);
  const search = searchDecisionLines(observation, candidates.actions, searchOptions);
  const byAction = new Map(search.candidates.map((candidate) => [candidate.actionKey, candidate]));
  const scored = candidates.actions
    .map((action) => actionHeuristic(action, observation.state, observation.kind))
    .map((action) => {
      const candidate = byAction.get(action.key);
      if (!candidate?.line) return { ...action, coverage: { ...action.coverage, supported: false,
        uncertaintyReasons: [...new Set([...action.coverage.uncertaintyReasons, ...search.reasons, ...(candidate?.reasons ?? [])])] } };
      return { ...action, heuristicScore: candidate.line.score, utility: candidate.line.score,
        decomposition: candidate.line.decomposition, sequence: candidate.line.sequence, endState: candidate.line.endState,
        scoreTrace: candidate.line.terms, rootDecomposition: action.decomposition,
        coverage: { ...action.coverage,
          cards: [...new Set(candidate.line.sequence.map((step) => step.identifier).filter(Boolean))].map((identifier) => ({ identifier, profile: decisionCardProfile(identifier) })),
          supported: !search.stats.budgetExhausted, uncertaintyReasons: search.stats.budgetExhausted ? ["search_budget_exhausted"] : [] } };
    })
    .sort((left, right) => right.heuristicScore - left.heuristicScore || left.key.localeCompare(right.key));
  let chosen = scored.find((action) => action.key === observation.chosenAction.key);
  if (!chosen && observation.chosenAction.source === "multi") {
    chosen = actionHeuristic(observation.chosenAction, observation.state, observation.kind);
  }
  if (!chosen) return null;
  const best = scored[0];
  const regretScore = round(Math.max(0, best.heuristicScore - chosen.heuristicScore), 2);
  const confidence = confidenceFor(observation, scored, candidates.budgetExhausted || search.stats.budgetExhausted);
  const tags = confidence === "low" ? [] : improvementTags(observation, chosen, best);
  const potential = handPotential(observation.state, best.utility);
  const executionQuality = round(clamp(100 - regretScore * 8, 0, 100), 1);
  const hiddenInformation = searchInformationSet(observation, candidates.actions,
    best.sequence ? { sequence: best.sequence, terms: best.scoreTrace } : null, {
      ...searchOptions,
      maxNodes: searchOptions.informationNodes ?? searchOptions.maxNodes,
    });
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
    chosenActionValue: chosen.heuristicScore,
    bestAction: best,
    bestActionValue: best.heuristicScore,
    alternatives: scored.filter((action) => action.key !== chosen.key && action.key !== best.key).slice(0, 2),
    regretScore,
    scoreUnit: "heuristic_points",
    horizon: chosen.sequence ? (observation.kind === "defense" ? "known_hand_response_turn" : "end_of_turn") : "current_decision",
    search: search.stats,
    hiddenInformation,
    learning: learningDiagnostics(observation, searchOptions.learningModel),
    chosenSequence: chosen.sequence ?? chosen.members ?? [observation.chosenAction],
    candidateSequences: scored.map((action) => ({ actionKey: action.key, sequence: action.sequence ?? action.members ?? [observation.legalActions.find((candidate) => candidate.key === action.key) ?? observation.chosenAction], score: action.heuristicScore, scoreTrace: action.scoreTrace ?? [], endState: action.endState ?? null })),
    coverage: { supported: confidence !== "low", evaluatedCandidates: scored.length, budget: 256, budgetExhausted: candidates.budgetExhausted },
    uncertaintyReasons: [...new Set([
      ...scored.flatMap((action) => action.coverage.uncertaintyReasons),
      ...(observation.dataQuality === "inferred" ? ["inferred_decision"] : []),
      ...(candidates.budgetExhausted ? ["candidate_budget_exhausted"] : []),
    ])],
    limitations: ["future_draws_not_simulated", "opponent_interruptions_not_simulated", "terminal_arsenal_value_known_cards_only", "hero_abilities_not_simulated", "opponent_response_not_simulated", "heuristic_not_calibrated"],
    confidence,
    marker: markerFor(regretScore, confidence),
    explanation: chosen.sequence && confidence !== "low"
      ? `Após a escolha capturada, a continuação calculada oferece ${chosen.decomposition.powerOffered} de poder, preserva ${chosen.decomposition.lifePreserved} de vida e paga ${chosen.decomposition.resourcesPaid} recursos. A alternativa oferece ${best.decomposition.powerOffered} de poder e preserva ${best.decomposition.lifePreserved} de vida. Diferença: ${regretScore.toFixed(2)} pontos heurísticos. A resposta adversária e as próximas compras não foram simuladas.`
      : explanationFor(observation, chosen, best, regretScore, confidence),
    improvementTags: tags,
    evidence: observation.dataQuality === "captured" ? "captured_decision_transparent_rules" : "safely_inferred_observational",
  };
}

function summaryFromAnalyses(analyses) {
  const trusted = analyses.filter((analysis) => analysis.confidence !== "low");
  const tagValues = new Map();
  for (const analysis of trusted) {
    for (const tag of analysis.improvementTags) {
      const values = tagValues.get(tag) ?? [];
      values.push(analysis.regretScore);
      tagValues.set(tag, values);
    }
  }
  const controllablePatterns = [...tagValues.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([tag, values]) => ({
      tag,
      label: PATTERN_LABELS[tag] ?? tag,
      occurrences: values.length,
      averageRegretScore: round(values.reduce((sum, value) => sum + value, 0) / values.length, 2),
    }))
    .sort((left, right) => right.occurrences - left.occurrences || right.averageRegretScore - left.averageRegretScore)
    .slice(0, 3);
  const average = (key) => trusted.length
    ? round(trusted.reduce((sum, analysis) => sum + analysis[key], 0) / trusted.length, 1)
    : null;
  return {
    evaluatedDecisions: trusted.length,
    lowConfidenceDecisions: analyses.length - trusted.length,
    averageHandPotential: average("handPotential"),
    averageExecutionQuality: average("executionQuality"),
    varianceLimitedHands: trusted.filter((analysis) => analysis.handPotential < 45 && analysis.executionQuality >= 80).length,
    executionBelowPotential: trusted.filter((analysis) => analysis.regretScore >= 2).length,
    controllablePatterns,
    deckSignals: [],
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
  const perDecisionBudget = Math.min(DEFAULT_TURN_SEARCH_BUDGET, Math.max(0, options.maxNodes ?? DEFAULT_TURN_SEARCH_BUDGET));
  let remainingNodes = 262144;
  let remainingInformationNodes = 262144;
  const analyses = [];
  for (const observation of observations) {
    const informationNodes = Math.min(perDecisionBudget, remainingInformationNodes);
    const validationNodes = Math.min(2048, Math.max(0, remainingInformationNodes - informationNodes));
    const analysis = analyzeDecisionObservation(observation, {
      maxNodes: Math.min(perDecisionBudget, remainingNodes), informationNodes, validationNodes,
      seed: options.seed, opponentModel: options.opponentModel,
      learningModel: options.learningModel,
    });
    if (!analysis) continue;
    remainingNodes -= analysis.search.nodesVisited;
    remainingInformationNodes -= analysis.hiddenInformation.search.workUnits + analysis.hiddenInformation.validation.workUnits;
    analyses.push(analysis);
  }
  const summary = summaryFromAnalyses(analyses);
  return {
    status: summary.evaluatedDecisions > 0 ? "ready" : "insufficient_data",
    versions: analysisVersions({ ...options, replaySchema: document?.schemaVersion ?? "unknown" }),
    observations,
    analyses,
    summary,
    methodology: {
      primaryObjective: "heuristic_score",
      scoreUnit: "heuristic_points",
      calibrated: false,
      horizon: "end_of_turn_or_known_hand_response",
      engineVersion: DECISION_TURN_ENGINE_VERSION,
      searchBudgetPerDecision: perDecisionBudget,
      totalSearchBudget: 262144,
      informationSearchVersion: INFORMATION_SEARCH_VERSION,
      opponentModelVersion: OPPONENT_MODEL_VERSION,
      informationSearchMode: "shadow",
      totalInformationSearchBudget: 262144,
      learningVersion: DECISION_LEARNING_VERSION,
      learningMode: "shadow",
      experimentalLearningUsed: analyses.some((analysis) => analysis.hiddenInformation.guidance.applied),
      benchmarkValidated: false,
      optimizationLabel: "melhor linha encontrada",
      usesFinalResult: false,
      collectiveEvidenceUsed: false,
      simulatorUsed: true,
      note: "Busca limitada e reproduzível com pitch, custos, AP, arsenal e efeitos auditados. Pontuação heurística de poder oferecido, vida e recursos; sem resposta adversária ou compras futuras. Janelas sem cobertura geram abstenção. A experiência de informação oculta é independente e não muda a nota ou o marcador.",
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

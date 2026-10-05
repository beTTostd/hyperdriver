import { decisionCardProfile } from "./decision-card-catalog.js";

export const DECISION_TURN_ENGINE_VERSION = "known-card-turn-1.0.0";
export const DEFAULT_TURN_SEARCH_BUDGET = 4096;
const MAX_CARDS = 8;
const round = (value) => Math.round(value * 1000) / 1000;
const integer = (value) => Number.isInteger(value) && value >= 0;
const zone = (value) => String(value ?? "").toUpperCase().replace(/^MY/, "").replace(/^ARS$/, "ARSENAL");
const pass = (action) => action.source === "pass" || /^(pass|skip|none|no)$/i.test(action.identifier) || /^pass/i.test(action.label);
const name = (identifier) => identifier.replaceAll("_", " ");

function inventory(cards, cardZone) {
  return cards.map((card, index) => ({
    ...card, instance: `${cardZone}:${card.instanceIndex ?? index}`, zone: cardZone,
    profile: decisionCardProfile(card.identifier),
  }));
}

export function createTurnState(known) {
  return {
    hand: inventory(known.own.hand, "HAND"), arsenal: inventory(known.own.arsenal, "ARSENAL"),
    equipment: inventory(known.own.equipment.filter((card) => card.slot !== "Hero" && !card.unavailable), "CHAR"),
    stage: "action", resources: known.own.resources, actionPoints: known.own.actionPoints,
    buffs: [], playedNimblism: false, pending: null, ended: false, response: false,
    powerOffered: 0, cardsConsumed: 0, cardsBlocked: 0, rawBlock: 0, equipmentSpent: 0,
    resourcesGenerated: 0, resourcesPaid: 0, pitch: [], discard: [],
    defendingEquipment: [],
  };
}

function findCard(state, instance) {
  return [...state.hand, ...state.arsenal, ...state.equipment].find((card) => card.instance === instance);
}

function removeCard(state, card) {
  const field = card.zone === "HAND" ? "hand" : card.zone === "ARSENAL" ? "arsenal" : "equipment";
  state[field] = state[field].filter((item) => item.instance !== card.instance);
}

// All search edges go through this transition function; exported for independent
// replay/verification of the returned line. No opponent private state is accepted.
export function applyTurnStep(previous, step) {
  const state = structuredClone(previous);
  if (state.ended && step.kind !== "response") throw new Error("Turn already ended");
  const card = step.instance ? findCard(state, step.instance) : null;
  if (step.kind === "declare") {
    if (state.stage !== "action" || state.pending || !card?.profile || state.actionPoints < 1 || card.restricted || card.unavailable) throw new Error("Illegal action declaration");
    if (card.profile.requires === "played_nimblism" && !state.playedNimblism) throw new Error("Activation condition not met");
    state.actionPoints -= 1;
    removeCard(state, card);
    if (card.zone === "HAND") state.cardsConsumed += 1;
    if (card.zone === "CHAR") state.equipmentSpent += 1;
    state.pending = card;
  } else if (step.kind === "pitch") {
    if (!state.pending || state.resources >= state.pending.profile.cost || card?.zone !== "HAND" || !card.profile?.pitch || card.restricted) throw new Error("Illegal pitch");
    removeCard(state, card);
    state.cardsConsumed += 1;
    state.resources += card.profile.pitch;
    state.resourcesGenerated += card.profile.pitch;
    state.pitch.push(card);
  } else if (step.kind === "resolve") {
    const pending = state.pending;
    if (!pending || state.resources < pending.profile.cost) throw new Error("Unpaid action");
    state.resources -= pending.profile.cost;
    state.resourcesPaid += pending.profile.cost;
    let goAgain = pending.profile.goAgain;
    if (pending.profile.type === "attack_action") {
      const applicable = (effect) => (effect.minCost === undefined || pending.profile.cost >= effect.minCost)
        && (effect.maxCost === undefined || pending.profile.cost <= effect.maxCost);
      const consumed = state.buffs.filter(applicable);
      state.buffs = state.buffs.filter((effect) => !applicable(effect));
      state.powerOffered += pending.profile.attack + consumed.reduce((sum, effect) => sum + (effect.amount ?? 0), 0);
      goAgain ||= consumed.some((effect) => effect.kind === "next_attack_go_again");
    }
    state.buffs.push(...pending.profile.effects);
    if (/^nimblism_/.test(pending.identifier)) state.playedNimblism = true;
    if (goAgain) state.actionPoints += 1;
    state.discard.push(pending);
    state.pending = null;
  } else if (step.kind === "arsenal") {
    if (!["action", "arsenal"].includes(state.stage) || state.pending || state.arsenal.length || card?.zone !== "HAND") throw new Error("Illegal arsenal selection");
    removeCard(state, card);
    state.arsenal.push({ ...card, zone: "ARSENAL" });
    state.stage = "arsenal";
  } else if (step.kind === "block") {
    if (state.stage !== "defense" || state.pending || !card?.profile || !["HAND", "CHAR"].includes(card.zone) || card.restricted || card.unavailable) throw new Error("Illegal block");
    removeCard(state, card);
    state.rawBlock += card.profile.defense;
    if (card.zone === "HAND") {
      state.cardsConsumed += 1;
      state.cardsBlocked += 1;
      state.discard.push(card);
    } else {
      // The supported zero-defense equipment has no blade break or battleworn.
      // Defending does not destroy it; it returns when the chain closes.
      state.defendingEquipment.push(card);
    }
  } else if (step.kind === "response") {
    if (state.stage !== "defense" || state.pending || state.response || !integer(step.incoming) || !integer(step.life) || step.life <= step.incoming - state.rawBlock) throw new Error("No surviving response");
    state.response = true;
    state.stage = "action";
    state.actionPoints = 1;
    state.resources = 0;
    state.buffs = [];
    state.equipment.push(...state.defendingEquipment);
    state.defendingEquipment = [];
  } else if (step.kind === "defeat") {
    if (state.stage !== "defense" || !integer(step.incoming) || !integer(step.life) || step.life > step.incoming - state.rawBlock) throw new Error("Invalid lethal endpoint");
    state.defeated = true;
    state.ended = true;
  } else if (step.kind === "end") {
    if (state.pending || !["action", "arsenal"].includes(state.stage)) throw new Error("Unpaid end of turn");
    state.resources = 0;
    state.actionPoints = 0;
    state.buffs = [];
    state.ended = true;
  } else throw new Error("Unknown transition");
  return state;
}

function edge(state, kind, card, extra = {}) {
  const step = { kind, instance: card?.instance, identifier: card?.identifier, ...extra };
  const next = applyTurnStep(state, step);
  const labels = {
    declare: `Jogar ${name(card?.identifier ?? "")} (custo ${card?.profile?.cost ?? 0})`,
    pitch: `Pitch ${name(card?.identifier ?? "")} (+${card?.profile?.pitch ?? 0} recursos)`,
    resolve: `Resolver ${name(state.pending?.identifier ?? "")} (+${next.powerOffered - state.powerOffered} poder)`,
    arsenal: `Guardar ${name(card?.identifier ?? "")} no arsenal`,
    block: `Bloquear com ${name(card?.identifier ?? "")} (+${card?.profile?.defense ?? 0} defesa)`,
    response: "Resposta com a mão conhecida preservada (1 AP, 0 recursos)",
    defeat: "Dano não bloqueado é letal; não há turno de resposta",
    end: "Encerrar turno; recursos, AP e bônus expiram; compras não simuladas",
  };
  return { state: next, step: {
    ...step, label: labels[kind], resourcesBefore: state.resources, resourcesAfter: next.resources,
    actionPointsBefore: state.actionPoints, actionPointsAfter: next.actionPoints,
    power: next.powerOffered - state.powerOffered,
  } };
}

// Conservative terminal reserve value: only the card saved and other retained
// known cards can finance it. No imagined draw, color bonus or hidden opponent.
function reservePower(state) {
  const reserved = state.arsenal[0];
  if (!reserved?.profile) return 0;
  const pitchAvailable = (excluded) => state.hand.filter((card) => card !== excluded).reduce((sum, card) => sum + card.profile.pitch, 0);
  if (reserved.profile.type === "attack_action") return reserved.profile.cost <= pitchAvailable(null) ? reserved.profile.attack : 0;
  return Math.max(0, ...state.hand.filter((card) => card.profile.type === "attack_action")
    .filter((card) => card.profile.cost <= pitchAvailable(card))
    .map((card) => card.profile.attack + reserved.profile.effects.filter((effect) =>
      effect.kind === "next_attack_bonus" && (effect.maxCost === undefined || card.profile.cost <= effect.maxCost))
      .reduce((sum, effect) => sum + effect.amount, 0)));
}

function valuation(state, known, kind, resourcesLost) {
  const incoming = kind === "defense" ? Math.max(0, known.chain.power - known.chain.defense) : 0;
  const lifePreserved = Math.min(incoming, state.rawBlock);
  const urgency = known.own.life <= incoming ? 2.8 : known.own.life <= 10 ? 1.55 : 0.9;
  const arsenalQuality = state.defeated ? 0 : reservePower(state);
  const terms = [
    { term: "lethal_endpoint", value: state.defeated ? 1 : 0, weight: -1000 },
    { term: "power_offered", value: state.powerOffered, weight: 0.82 },
    { term: "life_preserved", value: lifePreserved, weight: urgency },
    { term: "known_arsenal_potential", value: arsenalQuality, weight: 0.35 },
    { term: "cards_consumed", value: state.cardsConsumed, weight: -0.65 },
    { term: "equipment_spent", value: state.equipmentSpent, weight: -0.65 },
    { term: "resources_lost_at_end", value: resourcesLost, weight: -0.1 },
  ].map((term) => ({ ...term, contribution: round(term.value * term.weight) }));
  return { score: round(terms.reduce((sum, term) => sum + term.contribution, 0)), terms, decomposition: {
    expectedDamage: 0, powerOffered: state.powerOffered, lifePreserved,
    rawBlock: state.rawBlock, overblock: Math.max(0, state.rawBlock - incoming), cardsConsumed: state.cardsConsumed,
    wastedPitch: resourcesLost, arsenalQuality, equipmentSpent: state.equipmentSpent,
    chainContinuity: 0, firstTurnCardsReplaced: 0, resourcesGenerated: state.resourcesGenerated,
    resourcesPaid: state.resourcesPaid,
  } };
}

function locateAction(state, action) {
  const matches = [...state.hand, ...state.arsenal, ...state.equipment].filter((card) => card.zone === zone(action.zone)
    && card.identifier === action.identifier);
  const byInput = matches.filter((card) => String(card.capturedInput ?? card.instance.split(":")[1]) === String(action.input));
  return byInput.length === 1 ? byInput[0] : matches.length === 1 ? matches[0] : null;
}

function coverageReasons(observation) {
  const state = observation.state;
  const reasons = [];
  if (!["action", "defense", "arsenal"].includes(observation.kind)) return ["unsupported_search_window"];
  if (!integer(state.own.resources) || !integer(state.own.actionPoints)) reasons.push("missing_search_resources");
  if (!integer(state.own.life) || state.own.life < 1) reasons.push("missing_life");
  if (observation.kind !== "defense" && !state.isOwnTurn) reasons.push("not_own_action_turn");
  if (observation.kind === "action" && state.chain) reasons.push("active_chain_not_simulated");
  if (state.own.hand.length + state.own.arsenal.length > MAX_CARDS) reasons.push("search_hand_limit");
  if (state.own.arsenal.length > 1) reasons.push("unsupported_arsenal_capacity");
  if (state.unsupportedPublicEffects) reasons.push("unsupported_public_effects");
  const cards = [...state.own.hand, ...state.own.arsenal, ...state.own.equipment.filter((card) => card.slot !== "Hero" && !card.unavailable)];
  if (cards.some((card) => !decisionCardProfile(card.identifier))) reasons.push("card_not_in_catalog");
  if (cards.some((card) => card.hasModifiers)) reasons.push("unsupported_modifier");
  if (cards.some((card) => card.restricted)) reasons.push("captured_restrictions_not_simulated");
  if (state.publicZones.ownDiscard.some((card) => decisionCardProfile(card.identifier)?.effects.length)) reasons.push("unobserved_turn_effects");
  if (observation.kind === "defense") {
    if (!integer(state.opponent.actionPoints)) reasons.push("missing_opponent_action_points");
    else if (state.opponent.actionPoints > 0) reasons.push("opponent_continuation_not_simulated");
    if (!integer(state.chain?.power) || !integer(state.chain?.defense)) reasons.push("missing_combat_values");
    if (!decisionCardProfile(state.chain?.attacker) || decisionCardProfile(state.chain.attacker)?.type !== "attack_action") reasons.push("unsupported_attacker_effects");
    if (state.chain?.goAgain || state.chain?.reactions?.length || state.chain?.overpower) reasons.push("opponent_continuation_not_simulated");
    if (state.chain?.dominate && state.chain.defense > 0) reasons.push("dominate_existing_blocks_unknown");
    if (state.turn === 0) reasons.push("first_turn_response_requires_unknown_draw");
  }
  return [...new Set(reasons)];
}

export function searchDecisionLines(observation, actions, { maxNodes = DEFAULT_TURN_SEARCH_BUDGET, collectLines = 0 } = {}) {
  const reasons = coverageReasons(observation);
  const budget = Math.max(0, Math.min(65536, Number.isFinite(maxNodes) ? Math.floor(maxNodes) : DEFAULT_TURN_SEARCH_BUDGET));
  const stats = { engine: DECISION_TURN_ENGINE_VERSION, algorithm: "enumeration_with_transpositions", seed: 0,
    budget, nodesVisited: 0, nodesPruned: 0, budgetExhausted: false, complete: false };
  if (reasons.length) return { supported: false, reasons, stats, candidates: [] };
  const initial = createTurnState(observation.state);
  initial.stage = observation.kind === "defense" ? "defense" : observation.kind === "arsenal" ? "arsenal" : "action";
  const candidates = [];
  const tick = () => {
    if (stats.nodesVisited >= budget) { stats.budgetExhausted = true; return false; }
    stats.nodesVisited += 1;
    return true;
  };
  for (const action of actions) {
    let best = null;
    const lines = [];
    const lineKeys = new Set();
    let linesTruncated = false;
    const record = (line) => {
      if (!best || line.score > best.score || (line.score === best.score && JSON.stringify(line.sequence) < JSON.stringify(best.sequence))) best = line;
      if (!collectLines) return;
      const key = JSON.stringify(line.sequence.map((step) => [step.kind, step.instance]));
      if (lineKeys.has(key)) return;
      lineKeys.add(key);
      if (lines.length < Math.min(64, collectLines)) lines.push(line);
      else linesTruncated = true;
    };
    const visited = new Set();
    const finish = (state, steps) => {
      if (!tick()) return;
      const options = [null, ...(state.arsenal.length ? [] : state.hand)];
      for (const reserved of options) {
        if (!tick()) break;
        let ending = { state, steps };
        if (reserved) {
          const next = edge(state, "arsenal", reserved);
          ending = { state: next.state, steps: [...steps, next.step] };
        }
        const lost = ending.state.resources;
        const next = edge(ending.state, "end");
        const value = valuation(next.state, observation.state, observation.kind, lost);
        const line = { sequence: [...ending.steps, next.step], endState: next.state, ...value };
        record(line);
      }
    };
    const walk = (state, steps, forced = null) => {
      if (!tick()) return;
      const signature = JSON.stringify({ hand: state.hand.map((card) => card.instance), arsenal: state.arsenal.map((card) => card.instance),
        equipment: state.equipment.map((card) => card.instance), resources: state.resources, ap: state.actionPoints,
        buffs: state.buffs, pending: state.pending?.instance, power: state.powerOffered, spent: state.cardsConsumed, equipmentSpent: state.equipmentSpent,
        rawBlock: state.rawBlock, cardsBlocked: state.cardsBlocked, defendingEquipment: state.defendingEquipment.map((card) => card.instance),
        stage: state.stage, response: state.response, nimblism: state.playedNimblism, generated: state.resourcesGenerated, forced: forced?.instance });
      if (visited.has(signature)) { stats.nodesPruned += 1; return; }
      visited.add(signature);
      if (state.pending) {
        if (state.resources >= state.pending.profile.cost) {
          const next = edge(state, "resolve");
          walk(next.state, [...steps, next.step]);
        } else for (const card of state.hand) {
          if (!card.profile.pitch || card.restricted) continue;
          const next = edge(state, "pitch", card);
          walk(next.state, [...steps, next.step]);
        }
        return;
      }
      if (!forced) finish(state, steps);
      if (state.actionPoints < 1) return;
      for (const card of forced ? [forced] : [...state.hand, ...state.arsenal, ...state.equipment]) {
        if (card.restricted || card.unavailable || (card.profile.requires === "played_nimblism" && !state.playedNimblism)) continue;
        const next = edge(state, "declare", card);
        walk(next.state, [...steps, next.step]);
      }
    };
    if (observation.kind === "action") {
      if (pass(action)) finish(initial, []);
      else {
        const card = locateAction(initial, action);
        if (card) walk(initial, [], card);
      }
    } else if (observation.kind === "arsenal") {
      if (pass(action)) {
        const next = edge(initial, "end");
        best = { sequence: [next.step], endState: next.state, ...valuation(next.state, observation.state, "arsenal", initial.resources) };
      } else {
        const card = locateAction(initial, action);
        if (card?.zone === "HAND" && !initial.arsenal.length) {
          const placed = edge(initial, "arsenal", card);
          const next = edge(placed.state, "end");
          best = { sequence: [placed.step, next.step], endState: next.state, ...valuation(next.state, observation.state, "arsenal", initial.resources) };
        }
      }
    } else {
      let blocked = initial;
      const steps = [];
      const selected = pass(action) ? [] : (action.members ?? [action]);
      let valid = true;
      for (const member of selected) {
        const card = locateAction(blocked, member);
        if (!card || !["HAND", "CHAR"].includes(card.zone)) { valid = false; break; }
        const next = edge(blocked, "block", card);
        blocked = next.state;
        steps.push(next.step);
      }
      const additions = pass(action) ? [] : observation.legalActions.filter((candidate) => !pass(candidate))
        .map((candidate) => locateAction(blocked, candidate)).filter((card) => card && ["HAND", "CHAR"].includes(card.zone));
      const unique = [...new Map(additions.map((card) => [card.instance, card])).values()];
      const defend = (state, line, index) => {
        if (!tick()) return;
        if (observation.state.chain.dominate && state.cardsBlocked > 1) return;
        const incoming = Math.max(0, observation.state.chain.power - observation.state.chain.defense);
        if (observation.state.own.life > incoming - state.rawBlock) {
          const next = edge(state, "response", null, { incoming, life: observation.state.own.life });
          walk(next.state, [...line, next.step]);
        } else {
          const next = edge(state, "defeat", null, { incoming, life: observation.state.own.life });
          const value = valuation(next.state, observation.state, "defense", 0);
          const endpoint = { sequence: [...line, next.step], endState: next.state, ...value };
          if (!best || endpoint.score > best.score) best = endpoint;
        }
        for (let i = index; i < unique.length; i += 1) {
          const next = edge(state, "block", unique[i]);
          defend(next.state, [...line, next.step], i + 1);
        }
      };
      if (valid) defend(blocked, steps, 0);
    }
    if (collectLines && best && !lines.includes(best)) lines.push(best);
    candidates.push({ actionKey: action.key, line: best, ...(collectLines ? { lines, linesTruncated } : {}),
      supported: Boolean(best), reasons: best ? [] : ["no_supported_complete_line"] });
  }
  stats.complete = !stats.budgetExhausted && candidates.every((candidate) => candidate.supported);
  return { supported: stats.complete, reasons: stats.budgetExhausted ? ["search_budget_exhausted"] : [], stats, candidates };
}

import { decisionCardProfile } from "./decision-card-catalog.js";

export const OPPONENT_MODEL_VERSION = "public-counts-generic-mixture-1.0.0";
export const UNKNOWN_OPPONENT_CARD = "unmodeled_opponent_card";
const IDENTIFIERS = ["wounding_blow_red", "wounding_blow_blue", "critical_strike_red", "brutal_assault_yellow", "nimblism_red", "nimblism_yellow", "nimblism_blue"];
const PRIORS = [
  { id: "power_first", label: "Ataques genéricos", weights: [3, 1, 3, 3, 1, 1, 1] },
  { id: "resource_dense", label: "Mais pitch e ataques", weights: [1, 3, 2, 2, 1, 2, 3] },
  { id: "nimblism_package", label: "Bônus com Nimblism", weights: [2, 2, 3, 1, 3, 2, 2] },
];
const integer = (value) => Number.isInteger(value) && value >= 0;
const copiesForFormat = (format) => format === "cc" ? 3 : ["blitz", "commoner"].includes(format) ? 2 : null;

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function validCounts(counts, limit) {
  return counts && typeof counts === "object" && !Array.isArray(counts)
    && Object.keys(counts).length <= 160 && Object.entries(counts).every(([id, copies]) =>
      /^[a-z0-9_]{1,96}$/.test(id) && !Object.hasOwn(Object.prototype, id) && integer(copies) && copies <= limit);
}

const total = (counts) => Object.values(counts).reduce((sum, copies) => sum + copies, 0);

// A provided model is an explicit research input, never read from a replay's
// final deck list, external URL, opponentHand identities or final result.
export function buildOpponentBelief(known, providedModel = null) {
  const knowledge = known.opponentKnowledge;
  const format = knowledge?.format;
  const maxCopies = copiesForFormat(format);
  const opponent = known.opponent;
  const reasons = [];
  if (!maxCopies) reasons.push("opponent_format_not_supported");
  if (!opponent.handCountKnown || !opponent.arsenalCountKnown || !integer(opponent.deckCount)) reasons.push("opponent_zone_counts_missing");
  if (!integer(opponent.handCount) || opponent.handCount > 8 || !integer(opponent.arsenalCount) || opponent.arsenalCount > 1 || opponent.deckCount > 160) reasons.push("opponent_zone_counts_out_of_range");
  if (knowledge?.unknownPublicCards) reasons.push("unlocated_public_opponent_cards");
  const outside = knowledge?.outsideHiddenZones ?? {};
  const visibleArsenal = knowledge?.visibleArsenal ?? [];
  const lowerBounds = knowledge?.lowerBoundCounts ?? {};
  if (maxCopies && !validCounts(lowerBounds, maxCopies)) reasons.push("opponent_copy_count_conflict");
  if (visibleArsenal.length > opponent.arsenalCount) reasons.push("opponent_arsenal_count_conflict");
  const hiddenArsenalCount = opponent.arsenalCount - visibleArsenal.length;
  const poolSize = opponent.handCount + hiddenArsenalCount + opponent.deckCount;
  const constraints = {
    hero: known.matchup.opponentHero, format, maxCopies, handCount: opponent.handCount,
    arsenalCount: opponent.arsenalCount, deckCount: opponent.deckCount,
    lowerBoundCounts: lowerBounds, outsideHiddenZones: outside,
    currentPitch: knowledge?.currentPitch ?? {}, returnedPitchHistory: knowledge?.returnedPitchHistory ?? [],
    pitchOrderKnown: false,
  };
  if (reasons.length) return { version: OPPONENT_MODEL_VERSION, supported: false, reasons, constraints, archetypes: [] };
  const unavailable = { ...outside };
  for (const id of visibleArsenal) unavailable[id] = (unavailable[id] ?? 0) + 1;
  if (providedModel) {
    if (!integer(providedModel.knownAtFrame) || providedModel.knownAtFrame > known.frameSequence) reasons.push("opponent_model_not_available_at_decision");
    if (providedModel.hero !== constraints.hero || providedModel.format !== format) reasons.push("opponent_model_context_mismatch");
    if (!validCounts(providedModel.initialCounts, maxCopies)) reasons.push("invalid_opponent_model_counts");
    if (providedModel.initialCounts && Object.keys(providedModel.initialCounts).some((id) => decisionCardProfile(id)?.type === "equipment")) reasons.push("opponent_model_contains_equipment");
    if (!reasons.length) {
      if (total(providedModel.initialCounts) !== poolSize + total(unavailable)) reasons.push("opponent_model_size_conflict");
      for (const [id, copies] of Object.entries(lowerBounds)) {
        if ((providedModel.initialCounts[id] ?? 0) < copies) reasons.push("opponent_model_public_count_conflict");
      }
    }
    const counts = {};
    if (!reasons.length) for (const [id, copies] of Object.entries(providedModel.initialCounts)) {
      const remaining = copies - (unavailable[id] ?? 0);
      if (remaining < 0) reasons.push("opponent_model_public_count_conflict");
      else if (remaining) counts[id] = remaining;
    }
    return {
      version: OPPONENT_MODEL_VERSION, supported: reasons.length === 0, reasons: [...new Set(reasons)], constraints,
      source: "explicit_model_known_at_decision", calibrated: false,
      archetypes: reasons.length ? [] : [{ id: "provided", label: "Lista fornecida para o experimento", weight: 1, counts, unknownCount: 0 }],
      visibleArsenal,
      limitations: ["hero_abilities_not_simulated", "opponent_reactions_not_simulated", "pitch_order_and_location_not_reconstructed"],
    };
  }
  // Partial, assumed mixtures. Reserve an explicit unknown mass instead of
  // pretending that these seven audited cards describe a whole opponent deck.
  const archetypes = PRIORS.map((prior) => {
    const counts = {};
    const target = Math.floor(poolSize * 0.75);
    let allocated = 0;
    while (allocated < target) {
      const eligible = IDENTIFIERS.map((id, index) => ({ id, index, copies: counts[id] ?? 0 }))
        .filter(({ id, copies }) => copies < maxCopies - (unavailable[id] ?? 0))
        .sort((a, b) => prior.weights[b.index] / (b.copies + 1) - prior.weights[a.index] / (a.copies + 1) || a.index - b.index);
      if (!eligible.length) break;
      const id = eligible[0].id;
      counts[id] = (counts[id] ?? 0) + 1;
      allocated += 1;
    }
    const unknownCount = poolSize - allocated;
    if (unknownCount) counts[UNKNOWN_OPPONENT_CARD] = unknownCount;
    const logEvidence = Object.entries(lowerBounds).reduce((sum, [id, copies]) => {
      const index = IDENTIFIERS.indexOf(id);
      return sum + copies * 0.25 * Math.log(index < 0 ? 1 : prior.weights[index]);
    }, 0);
    return { id: prior.id, label: prior.label, counts, unknownCount, logEvidence };
  });
  const largest = Math.max(...archetypes.map((model) => model.logEvidence));
  const weights = archetypes.map((model) => Math.exp(model.logEvidence - largest));
  const normalizer = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    version: OPPONENT_MODEL_VERSION, supported: true, reasons: [], constraints,
    source: "assumed_partial_generic_mixture", calibrated: false, visibleArsenal,
    archetypes: archetypes.map((model, index) => ({ id: model.id, label: model.label, counts: model.counts,
      unknownCount: model.unknownCount, weight: weights[index] / normalizer })),
    limitations: ["assumed_archetypes_not_empirical", "unknown_opponent_card_mass", "hero_abilities_not_simulated",
      "opponent_reactions_not_simulated", "pitch_order_and_location_not_reconstructed"],
  };
}

export function sampleOpponentScenario(belief, random, archetypeId = null) {
  if (!belief.supported) return null;
  let model = belief.archetypes.find((item) => item.id === archetypeId);
  if (!model) {
    let value = random();
    model = belief.archetypes.at(-1);
    for (const item of belief.archetypes) {
      value -= item.weight;
      if (value <= 0) { model = item; break; }
    }
  }
  const remaining = { ...model.counts };
  const draw = () => {
    let value = Math.floor(random() * total(remaining));
    for (const [id, copies] of Object.entries(remaining)) {
      value -= copies;
      if (value < 0) { remaining[id] -= 1; return id; }
    }
    throw new Error("Opponent pool exhausted");
  };
  const hand = Array.from({ length: belief.constraints.handCount }, draw);
  const arsenal = [...belief.visibleArsenal, ...Array.from({ length: belief.constraints.arsenalCount - belief.visibleArsenal.length }, draw)];
  return {
    archetype: model.id, hand, arsenal, remainingDeckCounts: remaining,
    supported: hand.every((id) => decisionCardProfile(id)?.type !== "equipment" && decisionCardProfile(id))
      && arsenal.every((id) => decisionCardProfile(id)?.type !== "equipment" && decisionCardProfile(id)),
  };
}

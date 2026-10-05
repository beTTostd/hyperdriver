import { createHash } from "node:crypto";
import { decisionCardProfile, DECISION_CARD_CATALOG_VERSION } from "./decision-card-catalog.js";

export const DECISION_LEARNING_VERSION = "linear-choice-observed-outcome-1.0.0";
export const DECISION_FEATURE_VERSION = "known-state-action-features-1.0.0";
export const STATE_FEATURE_NAMES = ["bias", "own_life", "opponent_life", "life_difference", "turn", "own_resources", "own_ap", "hand_size", "arsenal_size", "hand_pitch", "hand_attack", "hand_defense", "hand_cost", "nimblism_count", "unknown_hand_cards", "opponent_hand_size", "opponent_deck_size", "chain_power", "chain_defense", "action_window", "defense_window", "arsenal_window", "pitch_window"];
export const ACTION_FEATURE_NAMES = [...STATE_FEATURE_NAMES, "pass", "attack", "cost", "defense", "pitch", "hand_cards_used", "equipment_used", "go_again", "attack_bonus", "known_funding", "nimblism_targets", "defense_urgency", "attack_life_pressure"];
const clamp = (value, scale = 1) => Math.max(-2, Math.min(2, Number.isFinite(value) ? value / scale : 0));
const isPass = (action) => action?.source === "pass" || /^(pass|skip|none|no)$/i.test(action?.identifier ?? "");
const handCards = (state) => Array.isArray(state.own?.hand) ? state.own.hand : [];
const zone = (value) => String(value ?? "").toUpperCase().replace(/^MY/, "").replace(/^ARS$/, "ARSENAL");
const sum = (cards, field) => cards.reduce((value, card) => value + (decisionCardProfile(card.identifier)?.[field] ?? 0), 0);

// A positive whitelist: no result, chosen action, reviewer score, identity, date,
// replay metadata or opponent private card enters a feature vector.
export function stateFeatures(observation) {
  const state = observation.state;
  const hand = handCards(state);
  return [1, clamp(state.own.life, 40), clamp(state.opponent.life, 40),
    clamp((state.own.life ?? 0) - (state.opponent.life ?? 0), 80), clamp(state.turn, 20),
    clamp(state.own.resources, 10), clamp(state.own.actionPoints, 4), clamp(hand.length, 8),
    clamp(state.own.arsenal.length), clamp(sum(hand, "pitch"), 24), clamp(sum(hand, "attack"), 40),
    clamp(sum(hand, "defense"), 24), clamp(sum(hand, "cost"), 16),
    clamp(hand.filter((card) => /^nimblism_/.test(card.identifier)).length, 8),
    clamp(hand.filter((card) => !decisionCardProfile(card.identifier)).length, 8),
    clamp(state.opponent.handCount, 8), clamp(state.opponent.deckCount, 80),
    clamp(state.chain?.power, 20), clamp(state.chain?.defense, 20),
    ...["action", "defense", "arsenal", "pitch"].map((kind) => Number(observation.kind === kind))];
}

export function actionFeatures(observation, action) {
  const members = action.members ?? [action];
  const profiles = members.map((member) => decisionCardProfile(member.identifier)).filter(Boolean);
  const total = (field) => profiles.reduce((value, profile) => value + (profile[field] ?? 0), 0);
  const pitch = sum(handCards(observation.state), "pitch");
  const cost = total("cost");
  const attack = total("attack");
  const nimblism = members.some((member) => /^nimblism_/.test(member.identifier));
  const targets = nimblism ? handCards(observation.state).filter((card) => {
    const profile = decisionCardProfile(card.identifier);
    return profile?.type === "attack_action" && profile.cost <= 1;
  }).length : 0;
  return [...stateFeatures(observation), Number(isPass(action)), clamp(attack, 10), clamp(cost, 4),
    clamp(total("defense"), 6), clamp(total("pitch"), 6),
    clamp(members.filter((member) => !isPass(member) && zone(member.zone) === "HAND").length, 8),
    clamp(members.filter((member) => zone(member.zone) === "CHAR").length),
    Number(profiles.some((profile) => profile.goAgain)),
    clamp(profiles.flatMap((profile) => profile.effects).reduce((value, effect) => value + (effect.amount ?? 0), 0), 6),
    Number(cost <= (observation.state.own.resources ?? 0) + pitch - total("pitch")),
    clamp(targets, 8), clamp(total("defense") * (observation.state.own.life <= (observation.state.chain?.power ?? 0) ? 2 : 1), 12),
    Number(attack >= (observation.state.opponent.life ?? Infinity) && attack > 0)];
}

export const dot = (weights, features) => weights.reduce((value, weight, index) => value + weight * features[index], 0);
export const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));
export function softmax(logits, temperature = 1) {
  const maximum = Math.max(...logits);
  const values = logits.map((value) => Math.exp((value - maximum) / temperature));
  const normalizer = values.reduce((value, item) => value + item, 0);
  return values.map((value) => value / normalizer);
}

export function learningDomain(observation) {
  return JSON.stringify([observation.state.matchup.hero, observation.state.opponentKnowledge?.format ?? null, observation.kind]);
}

export function learningCandidates(observation) {
  if (!["action", "defense", "pitch", "arsenal"].includes(observation.kind)) return [];
  if (!Array.isArray(observation.legalActions) || observation.legalActions.length < 2 || observation.legalActions.length > 32) return [];
  if (observation.legalActions.some((action) => action.members || (!isPass(action) && !decisionCardProfile(action.identifier)))) return [];
  return [...observation.legalActions].sort((a, b) => a.key.localeCompare(b.key));
}

export function validLearningArtifact(artifact) {
  const weights = (value, size) => Array.isArray(value) && value.length === size && value.every((item) => Number.isFinite(item) && Math.abs(item) <= 50);
  const range = (value, size) => Array.isArray(value) && value.length === size && value.every((item) =>
    Array.isArray(item) && item.length === 2 && item.every(Number.isFinite) && item[0] <= item[1]);
  const valid = Boolean(artifact && artifact.version === DECISION_LEARNING_VERSION && artifact.featureVersion === DECISION_FEATURE_VERSION
    && artifact.cardCatalogVersion === DECISION_CARD_CATALOG_VERSION && artifact.mode === "shadow"
    && /^[a-f0-9]{64}$/.test(artifact.id) && Number.isFinite(artifact.availableAfter)
    && Array.isArray(artifact.domains) && artifact.domains.length <= 256 && artifact.domains.every((domain) => typeof domain === "string" && domain.length < 512)
    && weights(artifact.choice?.weights, ACTION_FEATURE_NAMES.length) && weights(artifact.outcome?.weights, STATE_FEATURE_NAMES.length)
    && range(artifact.choice?.ranges, ACTION_FEATURE_NAMES.length) && range(artifact.outcome?.ranges, STATE_FEATURE_NAMES.length)
    && [artifact.choice.temperature, artifact.outcome.temperature].every((value) => Number.isFinite(value) && value >= 0.25 && value <= 4)
    && Number.isFinite(artifact.outcome.baselineProbability) && artifact.outcome.baselineProbability >= 0 && artifact.outcome.baselineProbability <= 1);
  if (!valid) return false;
  const { id, ...contents } = artifact;
  return id === createHash("sha256").update(JSON.stringify(contents)).digest("hex");
}

function inferenceReasons(observation, artifact) {
  if (!artifact) return ["learned_model_not_loaded"];
  if (!validLearningArtifact(artifact)) return ["learned_model_invalid_or_incompatible"];
  const reasons = [];
  if (!Number.isFinite(observation.state.observedAt)) reasons.push("decision_time_not_known");
  else if (artifact.availableAfter > observation.state.observedAt) reasons.push("learned_model_from_future");
  if (!artifact.domains.includes(learningDomain(observation))) reasons.push("learned_model_domain_not_covered");
  if (![observation.state.own.life, observation.state.opponent.life, observation.state.own.resources, observation.state.own.actionPoints].every(Number.isFinite)) reasons.push("learned_state_values_missing");
  if ([...handCards(observation.state), ...(observation.state.own.arsenal ?? [])].some((card) => !decisionCardProfile(card.identifier) || card.hasModifiers || card.restricted)
    || observation.state.unsupportedPublicEffects) reasons.push("learned_features_not_covered");
  return reasons;
}

const inRange = (features, ranges) => features.every((value, index) => value >= ranges[index][0] - 0.15 && value <= ranges[index][1] + 0.15);

export function predictHumanChoice(observation, artifact) {
  const reasons = inferenceReasons(observation, artifact);
  const candidates = learningCandidates(observation);
  if (!candidates.length) reasons.push("learned_candidates_not_covered");
  if (reasons.length) return { supported: false, reasons, actions: [] };
  const features = candidates.map((action) => actionFeatures(observation, action));
  if (features.some((vector) => !inRange(vector, artifact.choice.ranges))) return { supported: false, reasons: ["learned_features_out_of_distribution"], actions: [] };
  const probabilities = softmax(features.map((vector) => dot(artifact.choice.weights, vector)), artifact.choice.temperature);
  return { supported: true, reasons: [], actions: candidates.map((action, index) => ({ actionKey: action.key, probability: probabilities[index] })),
    target: "observed_human_choice", optimalityClaim: false };
}

export function predictObservedOutcome(observation, artifact) {
  const reasons = inferenceReasons(observation, artifact);
  if (reasons.length) return { supported: false, reasons };
  const features = stateFeatures(observation);
  if (!inRange(features, artifact.outcome.ranges)) return { supported: false, reasons: ["learned_features_out_of_distribution"] };
  return { supported: true, reasons: [], probability: sigmoid(dot(artifact.outcome.weights, features) / artifact.outcome.temperature),
    target: "observed_match_outcome", counterfactualValue: false, strategicallyValidated: false };
}

export function learningDiagnostics(observation, artifact) {
  const choice = predictHumanChoice(observation, artifact);
  const outcome = predictObservedOutcome(observation, artifact);
  return { version: DECISION_LEARNING_VERSION, mode: "shadow", modelId: validLearningArtifact(artifact) ? artifact.id : null,
    affectsRecommendation: false, humanChoice: choice, observedOutcome: outcome,
    searchPriorEligible: choice.supported && artifact?.choice?.independentTestImproved === true,
    limitations: ["human_frequency_not_optimality", "observed_outcome_not_counterfactual", "independent_strategic_review_required"] };
}

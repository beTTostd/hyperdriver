import { applyTurnStep, createTurnState, searchDecisionLines } from "./decision-turn-search.js";
import { decisionCardProfile } from "./decision-card-catalog.js";
import { buildOpponentBelief, OPPONENT_MODEL_VERSION, sampleOpponentScenario, seededRandom } from "./decision-opponent-model.js";
import { learningDiagnostics } from "./decision-learning.js";

export const INFORMATION_SEARCH_VERSION = "committed-line-so-ismcts-guided-2.0.0";
export const OPPONENT_POLICIES = ["preserve_hand", "protect_life"];
const round = (value) => Math.round(value * 1000) / 1000;
const clampBudget = (value, fallback) => Math.max(0, Math.min(4096, Number.isFinite(value) ? Math.floor(value) : fallback));
const lineKey = (sequence) => JSON.stringify(sequence.map((step) => [step.kind, step.instance]));
const budgetCounter = (budget) => ({ budget, used: 0, exhausted: false, spend() {
  if (this.used >= this.budget) { this.exhausted = true; return false; }
  this.used += 1;
  return true;
} });

// The defending policy receives only its own hand and the currently revealed
// attack. Neither the attacker's hand nor future steps enter this interface.
export function chooseOpponentBlocks(view, ownHand, policy, work = budgetCounter(4096)) {
  if (!OPPONENT_POLICIES.includes(policy) || ownHand.length > 8 || ownHand.some((id) => !decisionCardProfile(id))) return null;
  let best = null;
  for (let mask = 0; mask < 2 ** ownHand.length; mask += 1) {
    if (!work.spend()) return null;
    const indices = ownHand.map((_, index) => index).filter((index) => mask & (1 << index));
    const block = indices.reduce((sum, index) => sum + decisionCardProfile(ownHand[index]).defense, 0);
    const damage = Math.max(0, view.power - block);
    const retainedCost = indices.reduce((sum, index) => {
      const card = decisionCardProfile(ownHand[index]);
      return sum + (card.attack * 0.35 + card.pitch * 0.35 + card.effects.length * 1.2);
    }, 0);
    const urgency = view.life <= view.power ? 3 : view.life <= 10 ? 1.5 : policy === "protect_life" ? 1.15 : 0.65;
    const utility = Math.min(view.power, block) * urgency - retainedCost - (damage >= view.life ? 1000 : 0);
    if (!best || utility > best.utility) best = { indices, block, damage, utility };
  }
  return best;
}

export function simulateCommittedLine(known, line, scenario, policy, work = budgetCounter(4096)) {
  if (!scenario?.supported) return { supported: false, reason: "sampled_opponent_cards_not_supported" };
  let state = createTurnState(known);
  let hand = [...scenario.hand];
  let life = known.opponent.life;
  let damage = 0;
  let cardsBlocked = 0;
  const attacks = [];
  let defeated = false;
  for (const step of line.sequence) {
    if (!work.spend()) return { supported: false, reason: "scenario_budget_exhausted" };
    const previousPower = state.powerOffered;
    state = applyTurnStep(state, step);
    const power = state.powerOffered - previousPower;
    if (!power) continue;
    const blocks = chooseOpponentBlocks({ power, life }, hand, policy, work);
    if (!blocks) return { supported: false, reason: "scenario_budget_exhausted" };
    const identifiers = blocks.indices.map((index) => hand[index]);
    hand = hand.filter((_, index) => !blocks.indices.includes(index));
    life -= blocks.damage;
    damage += blocks.damage;
    cardsBlocked += blocks.indices.length;
    attacks.push({ power, rawBlock: blocks.block, damage: blocks.damage, hypotheticalBlocks: identifiers, lifeAfter: life });
    if (life <= 0) { defeated = true; break; }
  }
  // Numeric explanations follow the actual simulated prefix. In particular a
  // lethal endpoint never receives value from actions scheduled after the win.
  const terms = line.terms.filter((term) => term.term !== "power_offered").map((term) => {
    const values = { cards_consumed: state.cardsConsumed, equipment_spent: state.equipmentSpent,
      known_arsenal_potential: defeated ? 0 : term.value, resources_lost_at_end: defeated ? 0 : term.value };
    return { ...term, value: values[term.term] ?? term.value };
  });
  terms.push({ term: "scenario_damage", value: damage, weight: 0.82 },
    { term: "opponent_cards_blocked", value: cardsBlocked, weight: known.turn === 0 ? 0 : 0.65 },
    { term: "opponent_lethal_endpoint", value: defeated ? 1 : 0, weight: 1000 });
  const trace = terms.map((term) => ({ ...term, contribution: round(term.value * term.weight) }));
  return { supported: true, score: round(trace.reduce((sum, term) => sum + term.contribution, 0)),
    damage, cardsBlocked, opponentLife: life, defeated, attacks, trace };
}

function node(key) { return { key, attempts: 0, visits: 0, sum: 0, reward: 0, prior: null, children: new Map(), plan: null }; }

function makeTree(plans, priors = []) {
  const root = node("information_set");
  for (const plan of plans) {
    let current = root;
    for (const key of [plan.actionKey, ...plan.line.sequence.map((step) => JSON.stringify([step.kind, step.instance]))]) {
      if (!current.children.has(key)) current.children.set(key, node(key));
      current = current.children.get(key);
    }
    current.plan = plan;
  }
  for (const [key, branch] of root.children) {
    const prior = priors.find((item) => item.actionKey === key);
    if (prior) branch.prior = 0.5 / root.children.size + 0.5 * prior.probability;
  }
  return root;
}

function selectPath(root, work) {
  const path = [root];
  let current = root;
  while (current.children.size) {
    if (!work.spend()) return null;
    const children = [...current.children.values()];
    const unvisited = children.filter((child) => !child.attempts).sort((a, b) => (b.prior ?? 0) - (a.prior ?? 0));
    current = unvisited[0] ?? children.reduce((best, child) => {
      const uct = (item) => (item.visits ? item.reward / item.visits : 0) + (item.prior === null
        ? Math.SQRT2 * Math.sqrt(Math.log(path.at(-1).attempts + 1) / item.attempts)
        : Math.SQRT2 * item.prior * Math.sqrt(path.at(-1).attempts + 1) / (item.attempts + 1));
      return uct(child) > uct(best) ? child : best;
    });
    path.push(current);
  }
  return current.plan ? path : null;
}

function leaves(current, found = []) {
  if (current.plan) found.push(current);
  for (const child of current.children.values()) leaves(child, found);
  return found;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// Restricted single-observer ISMCTS over committed turn plans. The tree is shared
// across determinizations. Selecting a local plan happens BEFORE the hidden hand
// is sampled, and the player cannot adapt that plan to an unrevealed sample.
export function searchInformationSet(observation, actions, baselineLine, options = {}) {
  const budget = clampBudget(options.maxNodes, 4096);
  const validationBudget = clampBudget(options.validationNodes, 2048);
  const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : parseInt(observation.stateFingerprint.slice(0, 8), 16);
  const belief = buildOpponentBelief(observation.state, options.opponentModel);
  const learned = learningDiagnostics(observation, options.learningModel);
  const result = { version: INFORMATION_SEARCH_VERSION, opponentModelVersion: OPPONENT_MODEL_VERSION,
    mode: "shadow", affectsRecommendation: false, scoreUnit: "heuristic_points", calibrated: false,
    seed, belief, supported: false, reasons: [], candidates: [], recommendationActionKey: null,
    guidance: { modelId: learned.modelId, applied: false, kind: "human_choice_exploration_prior",
      affectsReward: false, outcomeModelUsedForSearch: false,
      reasons: learned.searchPriorEligible ? [] : learned.humanChoice.reasons.length ? learned.humanChoice.reasons : ["learned_prior_not_independently_improved"] },
    search: { budget, workUnits: 0, enumerationNodes: 0, iterations: 0, supportedIterations: 0,
      treePolicy: "shared_information_set_uct", strategy: "commit_before_hidden_sample", budgetExhausted: false },
    stability: null, comparison: null,
    validation: { budget: validationBudget, workUnits: 0, budgetExhausted: false, groups: [] },
  };
  if (!belief.supported) { result.reasons = belief.reasons; return result; }
  if (observation.kind !== "action" || observation.state.chain) {
    result.reasons = ["information_search_window_not_supported"]; return result;
  }
  if (!Number.isInteger(observation.state.opponent.life) || observation.state.opponent.life < 1) {
    result.reasons = ["opponent_life_missing"]; return result;
  }
  if (observation.state.opponent.equipment.some((card) => card.slot !== "Hero" && !card.unavailable && !decisionCardProfile(card.identifier))) {
    result.reasons = ["opponent_equipment_not_supported"]; return result;
  }
  const orderedActions = [...actions].sort((a, b) => a.key.localeCompare(b.key));
  const library = searchDecisionLines(observation, orderedActions, { maxNodes: Math.floor(budget / 2), collectLines: 64 });
  result.search.enumerationNodes = library.stats.nodesVisited;
  result.search.workUnits = library.stats.nodesVisited;
  const plans = library.candidates.flatMap((candidate) => (candidate.lines ?? []).map((line) => ({ actionKey: candidate.actionKey, line })));
  if (!library.supported || !plans.length || !baselineLine) {
    result.reasons = [...library.reasons, "information_line_library_incomplete"]; return result;
  }
  const libraryTruncated = library.candidates.some((candidate) => candidate.linesTruncated) || plans.length > 512;
  if (libraryTruncated) result.reasons.push("information_line_library_truncated");
  const root = makeTree(plans.slice(0, 512), learned.searchPriorEligible ? learned.humanChoice.actions : []);
  result.guidance.applied = learned.searchPriorEligible;
  if (learned.searchPriorEligible) result.search.treePolicy = "human_choice_root_puct_shared_information_set_uct";
  const trainingWork = budgetCounter(budget - library.stats.nodesVisited);
  for (let iteration = 0; iteration < 256; iteration += 1) {
    const path = selectPath(root, trainingWork);
    if (!path) break;
    // Sampling RNG is independent of selection and rollout path length.
    const scenario = sampleOpponentScenario(belief, seededRandom((seed + Math.imul(iteration + 1, 2654435761)) >>> 0));
    const outcome = simulateCommittedLine(observation.state, path.at(-1).plan.line, scenario, OPPONENT_POLICIES[iteration % 2], trainingWork);
    if (outcome.reason === "scenario_budget_exhausted") break;
    result.search.iterations += 1;
    if (outcome.supported) result.search.supportedIterations += 1;
    for (const current of path) {
      current.attempts += 1;
      if (outcome.supported) {
        current.visits += 1;
        current.sum += outcome.score;
        current.reward += Math.tanh(outcome.score / 12);
      }
    }
  }
  result.search.workUnits += trainingWork.used;
  result.search.budgetExhausted = trainingWork.exhausted;
  const selected = [];
  for (const [actionKey, branch] of root.children) {
    const visited = leaves(branch).filter((leaf) => leaf.visits);
    visited.sort((a, b) => b.sum / b.visits - a.sum / a.visits || lineKey(a.plan.line.sequence).localeCompare(lineKey(b.plan.line.sequence)));
    if (visited.length) selected.push({ ...visited[0].plan, actionKey, visits: visited[0].visits,
      trainingScore: round(visited[0].sum / visited[0].visits) });
  }
  selected.sort((a, b) => b.trainingScore - a.trainingScore || a.actionKey.localeCompare(b.actionKey));
  if (!selected.length) { result.reasons.push("no_covered_opponent_samples"); return result; }
  const chosen = selected[0];
  result.recommendationActionKey = chosen.actionKey;
  result.candidates = selected.map((plan) => ({ actionKey: plan.actionKey, sequence: plan.line.sequence,
    trainingScore: plan.trainingScore, visits: plan.visits }));
  if (selected.length !== actions.length) result.reasons.push("information_actions_under_sampled");
  // Held-out paired scenarios evaluate the already selected plans and baseline.
  // Validation cannot change the tree's recommendation or tune its policy.
  const work = budgetCounter(validationBudget);
  const groups = belief.archetypes.flatMap((model) => OPPONENT_POLICIES.map((policy) => ({
    archetype: model.id, policy, weight: model.weight / OPPONENT_POLICIES.length,
    attempted: 0, covered: 0, trials: [],
  })));
  let stopped = false;
  for (let trial = 0; trial < 4 && !stopped; trial += 1) for (const group of groups) {
    const modelIndex = belief.archetypes.findIndex((model) => model.id === group.archetype);
    const random = seededRandom((seed ^ 0x85ebca6b ^ Math.imul(trial + 1, 2246822519) ^ Math.imul(modelIndex + 1, 3266489917)) >>> 0);
    const scenario = sampleOpponentScenario(belief, random, group.archetype);
    group.attempted += 1;
    if (!scenario.supported) continue;
    const outcomes = selected.map((plan) => simulateCommittedLine(observation.state, plan.line, scenario, group.policy, work));
    const baseline = simulateCommittedLine(observation.state, baselineLine, scenario, group.policy, work);
    if (!baseline.supported || outcomes.some((outcome) => !outcome.supported)) { stopped = true; break; }
    group.covered += 1;
    group.trials.push({ scores: outcomes.map((outcome) => outcome.score), baseline: baseline.score,
      gain: round(outcomes[0].score - baseline.score), damage: outcomes[0].damage });
  }
  result.validation.workUnits = work.used;
  result.validation.budgetExhausted = work.exhausted;
  result.validation.groups = groups.map((group) => ({
    archetype: group.archetype, policy: group.policy, weight: group.weight, attempted: group.attempted, covered: group.covered,
    candidates: group.covered ? selected.map((plan, index) => ({ actionKey: plan.actionKey,
      meanScore: round(mean(group.trials.map((trial) => trial.scores[index]))) })) : [],
    meanGainOverBaseline: group.covered ? round(mean(group.trials.map((trial) => trial.gain))) : null,
  }));
  const coveredGroups = groups.filter((group) => group.covered);
  const coveredWeight = coveredGroups.reduce((sum, group) => sum + group.weight, 0);
  const weighted = (value) => coveredGroups.reduce((sum, group) => sum + group.weight * value(group), 0) / coveredWeight;
  const hiddenSlots = belief.constraints.handCount + belief.constraints.arsenalCount - belief.visibleArsenal.length;
  const unmodeledMass = hiddenSlots > 0 && belief.archetypes.some((model) =>
    Object.entries(model.counts).some(([id, copies]) => copies > 0 && !decisionCardProfile(id)));
  const allCovered = !unmodeledMass && groups.every((group) => group.attempted >= 2 && group.covered === group.attempted);
  if (unmodeledMass) result.reasons.push("opponent_model_has_unmodeled_mass");
  if (!allCovered) result.reasons.push("opponent_scenario_coverage_incomplete");
  if (work.exhausted) result.reasons.push("information_validation_budget_exhausted");
  if (coveredWeight) {
    const agreement = weighted((group) => {
      const means = selected.map((_, index) => mean(group.trials.map((trial) => trial.scores[index])));
      return Math.max(...means) - means[0] <= 0.25 ? 1 : 0;
    });
    const gains = coveredGroups.flatMap((group) => group.trials.map((trial) => trial.gain));
    result.stability = { agreement: round(agreement), stableAcrossCoveredGroups: agreement === 1,
      complete: allCovered, testedArchetypes: new Set(coveredGroups.map((group) => group.archetype)).size,
      policies: OPPONENT_POLICIES, tolerancePoints: 0.25 };
    result.comparison = {
      baseline: "bounded_turn_enumeration", algorithmBudget: budget, validationBudget,
      pairedScenarios: coveredGroups.reduce((sum, group) => sum + group.covered, 0),
      meanGain: round(weighted((group) => mean(group.trials.map((trial) => trial.gain)))),
      sampledGainRange: [Math.min(...gains), Math.max(...gains)],
      experimentalMeanScore: round(weighted((group) => mean(group.trials.map((trial) => trial.scores[0])))),
      baselineMeanScore: round(weighted((group) => mean(group.trials.map((trial) => trial.baseline)))),
      conditionalOnCoveredScenarios: !allCovered, strategicallyValidated: false,
    };
    if (agreement !== 1) result.reasons.push("opponent_scenarios_change_ranking");
  }
  result.supported = allCovered && !libraryTruncated && selected.length === actions.length;
  result.reasons = [...new Set(result.reasons)];
  return result;
}

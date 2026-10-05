import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeReplayDecisions, extractDecisionObservations } from "../lib/decision-analysis-core.js";
import { buildOpponentBelief, sampleOpponentScenario, seededRandom, UNKNOWN_OPPONENT_CARD } from "../lib/decision-opponent-model.js";
import { chooseOpponentBlocks, searchInformationSet, simulateCommittedLine } from "../lib/decision-information-search.js";
import { searchDecisionLines } from "../lib/decision-turn-search.js";
import { compareInformationSearch } from "../lib/decision-search-benchmark.js";

function document(overrides = {}) {
  return { schemaVersion: "0.3.0", match: {
    frames: [{ sequence: 1, payload: {
      initialLoad: { gameFormat: "cc" }, turnNo: 1, turnPlayer: "1", otherPlayer: "2",
      playerAP: 1, opponentAP: 0, playerPitchCount: 0, opponentPitchCount: 0,
      playerHealth: 20, opponentHealth: 20, opponentDeckCount: 2, canPassPhase: true,
      turnPhase: { turnPhase: "A", caption: "Action" },
      playerArse: [], opponentArse: [],
      playerEquipment: [{ cardNumber: "local_hero", slot: "Hero", controller: "1" }],
      opponentEquipment: [{ cardNumber: "opponent_hero", slot: "Hero", controller: "2" }],
      playerHand: ["nimblism_red", "critical_strike_red", "wounding_blow_blue"].map((cardNumber, index) => ({ cardNumber, action: 3, actionData: String(index) })),
      opponentHand: [{ cardNumber: "CardBack" }, { cardNumber: "CardBack" }],
      ...overrides,
    } }], decisionEvents: [{ frameSequence: 1, choice: { action: "3", zone: "MYHAND", identifier: "0" } }],
  } };
}

const model = (initialCounts = { nimblism_red: 2, wounding_blow_blue: 2 }) => ({
  knownAtFrame: 1, hero: "opponent_hero", format: "cc", initialCounts,
});
const observation = (replay) => extractDecisionObservations(replay)[0];
const baseline = (obs) => searchDecisionLines(obs, obs.legalActions).candidates.map((candidate) => candidate.line).filter(Boolean).sort((a, b) => b.score - a.score)[0];

test("public knowledge retains physical-copy lower bounds and pitch history without multiplying repeated frames", () => {
  const replay = document({ opponentPitch: [{ cardNumber: "wounding_blow_blue" }, { cardNumber: "wounding_blow_blue" }] });
  const frame = replay.match.frames[0];
  replay.match.frames.push({ sequence: 2, payload: { ...structuredClone(frame.payload), playerHealth: 19 } });
  replay.match.frames.push({ sequence: 3, payload: { ...structuredClone(frame.payload), turnNo: 2, opponentPitch: [], opponentDeckCount: 4 } });
  replay.match.decisionEvents.push({ ...replay.match.decisionEvents[0], frameSequence: 2 }, { ...replay.match.decisionEvents[0], frameSequence: 3 });
  const observations = extractDecisionObservations(replay);
  assert.equal(observations[1].state.opponentKnowledge.lowerBoundCounts.wounding_blow_blue, 2);
  const knowledge = observations[2].state.opponentKnowledge;
  assert.equal(knowledge.lowerBoundCounts.wounding_blow_blue, 2);
  assert.equal(knowledge.returnedPitchHistory.length, 1);
  assert.deepEqual(knowledge.returnedPitchHistory[0].cards, [{ identifier: "wounding_blow_blue", count: 2 }]);
  assert.equal(knowledge.returnedPitchHistory[0].orderKnown, false);
  assert.equal(knowledge.returnedPitchHistory[0].destination, "not_reconstructed");
});

test("a provided belief removes current public copies and samples without replacement, including arsenal", () => {
  const obs = observation(document({ opponentDeckCount: 1, opponentArse: [{ cardNumber: "CardBack", facing: "DOWN" }],
    opponentDiscard: [{ cardNumber: "nimblism_red" }], opponentPitch: [{ cardNumber: "wounding_blow_blue" }] }));
  const belief = buildOpponentBelief(obs.state, model({ nimblism_red: 3, wounding_blow_blue: 3 }));
  assert.equal(belief.supported, true);
  assert.deepEqual(belief.archetypes[0].counts, { nimblism_red: 2, wounding_blow_blue: 2 });
  for (let seed = 0; seed < 100; seed += 1) {
    const sample = sampleOpponentScenario(belief, seededRandom(seed));
    const counts = {};
    for (const id of [...sample.hand, ...sample.arsenal]) counts[id] = (counts[id] ?? 0) + 1;
    assert.equal(sample.hand.length, 2);
    assert.equal(sample.arsenal.length, 1);
    for (const [id, copies] of Object.entries(counts)) assert.ok(copies <= 2, id);
    assert.equal(Object.values(sample.remainingDeckCounts).reduce((sum, copies) => sum + copies, 0), 1);
  }
});

test("undo removes sightings from the abandoned branch before building opponent beliefs", () => {
  const replay = document();
  const initial = structuredClone(replay.match.frames[0].payload);
  replay.match.frames.push(
    { sequence: 2, payload: { ...structuredClone(initial), opponentDiscard: [{ cardNumber: "abandoned_secret" }] } },
    { sequence: 3, payload: structuredClone(initial) },
    { sequence: 4, payload: { ...structuredClone(initial), turnNo: 2, opponentPitch: [{ cardNumber: "wounding_blow_blue" }] } },
  );
  replay.match.decisionEvents = [{ frameSequence: 4, choice: { action: "3", zone: "MYHAND", identifier: "0" } }];
  const obs = observation(replay);
  assert.equal(obs.state.opponentKnowledge.lowerBoundCounts.abandoned_secret, undefined);
  assert.equal(obs.state.opponentKnowledge.lowerBoundCounts.wounding_blow_blue, 1);
  assert.equal(JSON.stringify(buildOpponentBelief(obs.state)).includes("abandoned_secret"), false);
});

test("future deck models, contradictory copy counts, missing counts and hidden public cards prevent inference", () => {
  const obs = observation(document());
  for (const bad of [
    { ...model(), knownAtFrame: 2 }, { ...model(), format: "blitz" },
    { ...model(), hero: "other_hero" }, model({ nimblism_red: 4 }), model({ nimblism_red: 1 }),
    model({ goliath_gauntlet: 2, nimblism_red: 2 }),
  ]) assert.equal(buildOpponentBelief(obs.state, bad).supported, false);
  const missing = observation(document({ opponentDeckCount: undefined })).state;
  assert.equal(buildOpponentBelief(missing).supported, false);
  const hidden = observation(document({ opponentBanish: [{ cardNumber: "private_banish", facing: "DOWN" }] })).state;
  assert.equal(JSON.stringify(hidden).includes("private_banish"), false);
  assert.equal(buildOpponentBelief(hidden).supported, false);
  const duplicate = observation(document({ opponentDiscard: Array.from({ length: 3 }, () => ({ cardNumber: "nimblism_red" })) })).state;
  assert.equal(buildOpponentBelief(duplicate, model()).supported, false);
});

test("unknown lists produce multiple explicit partial priors and unmodeled mass rather than a fictitious full deck", () => {
  const obs = observation(document({ opponentDeckCount: 40 }));
  const belief = buildOpponentBelief(obs.state);
  assert.equal(belief.source, "assumed_partial_generic_mixture");
  assert.equal(belief.calibrated, false);
  assert.equal(belief.archetypes.length, 3);
  assert.ok(Math.abs(belief.archetypes.reduce((sum, prior) => sum + prior.weight, 0) - 1) < 1e-10);
  for (const prior of belief.archetypes) {
    assert.equal(Object.values(prior.counts).reduce((sum, copies) => sum + copies, 0), 42);
    assert.ok(prior.counts[UNKNOWN_OPPONENT_CARD] > 0);
  }
  const search = analyzeReplayDecisions(document({ opponentDeckCount: 40 })).analyses[0].hiddenInformation;
  assert.equal(search.affectsRecommendation, false);
  assert.equal(search.supported, false);
  assert.ok(search.reasons.includes("opponent_scenario_coverage_incomplete") || search.reasons.includes("no_covered_opponent_samples"));
});

test("the defender observes only its own cards and current attack and avoids lethal damage when possible", () => {
  const view = { power: 5, life: 3 };
  const hand = ["wounding_blow_blue", "nimblism_red"];
  const first = chooseOpponentBlocks(view, hand, "preserve_hand");
  assert.equal(first.damage < view.life, true);
  assert.deepEqual(first, chooseOpponentBlocks({ ...view, hiddenAttackerHand: ["secret"], futureAttack: 100 }, hand, "preserve_hand"));
});

test("committed simulation consumes blockers once and its numeric trace reproduces the score", () => {
  const obs = observation(document());
  const line = baseline(obs);
  const sample = { supported: true, hand: ["nimblism_red", "wounding_blow_blue"], arsenal: [], archetype: "test" };
  const simulated = simulateCommittedLine(obs.state, line, sample, "protect_life");
  assert.equal(simulated.supported, true);
  assert.ok(simulated.damage <= line.decomposition.powerOffered);
  assert.ok(simulated.cardsBlocked <= sample.hand.length);
  assert.equal(simulated.score, Math.round(simulated.trace.reduce((sum, term) => sum + term.contribution, 0) * 1000) / 1000);
  assert.deepEqual(sample.hand, ["nimblism_red", "wounding_blow_blue"]);
});

test("information-set UCT is seeded, shared across samples and validated on separate paired scenarios", () => {
  const replay = document();
  const options = { opponentModel: model(), seed: 17 };
  const first = analyzeReplayDecisions(replay, options);
  assert.deepEqual(first, analyzeReplayDecisions(replay, options));
  const hidden = first.analyses[0].hiddenInformation;
  assert.equal(hidden.mode, "shadow");
  assert.equal(hidden.search.treePolicy, "shared_information_set_uct");
  assert.equal(hidden.search.strategy, "commit_before_hidden_sample");
  assert.ok(hidden.search.workUnits <= hidden.search.budget);
  assert.ok(hidden.validation.workUnits <= hidden.validation.budget);
  assert.equal(hidden.validation.groups.length, 2);
  assert.ok(hidden.validation.groups.every((group) => group.covered >= 2));
  assert.equal(hidden.comparison.conditionalOnCoveredScenarios, false);
  assert.equal(hidden.comparison.strategicallyValidated, false);
  assert.equal(first.analyses[0].bestAction.identifier, "nimblism_red");
  assert.ok(first.analyses.every((analysis) => analysis.confidence !== "high"));
});

test("a small solved lethal subproblem improves on the power-only baseline with the same search cap", () => {
  const replay = document({ opponentHand: [], opponentDeckCount: 1, opponentHealth: 5,
    playerHand: ["critical_strike_red", "wounding_blow_red", "wounding_blow_blue"].map((cardNumber, index) => ({ cardNumber, action: 3, actionData: String(index) })) });
  const result = analyzeReplayDecisions(replay, { opponentModel: model({ wounding_blow_red: 1 }), seed: 17 });
  const analysis = result.analyses[0];
  assert.equal(analysis.bestAction.identifier, "wounding_blow_red");
  const hidden = analysis.hiddenInformation;
  const recommendation = hidden.candidates.find((candidate) => candidate.actionKey === hidden.recommendationActionKey);
  assert.equal(recommendation.sequence[0].identifier, "critical_strike_red");
  assert.ok(hidden.comparison.meanGain > 0);
  assert.equal(hidden.comparison.algorithmBudget, analysis.search.budget);
  assert.equal(hidden.supported, true);
  const chosenLine = { sequence: recommendation.sequence, terms: baseline(observation(replay)).terms };
  const simulation = simulateCommittedLine(observation(replay).state, chosenLine, { supported: true, hand: [], arsenal: [] }, "preserve_hand");
  assert.equal(simulation.defeated, true);
  assert.equal(simulation.attacks.length, 1);
  assert.equal(simulation.trace.find((term) => term.term === "known_arsenal_potential").value, 0);
});

test("future reveals, private identities, final outcome and a private final deck list cannot affect the experiment", () => {
  const replay = document();
  const first = analyzeReplayDecisions(replay, { opponentModel: model(), seed: 23 }).analyses[0];
  const future = structuredClone(replay);
  future.match.summary = { winner: "2" };
  future.match.opponentDeck = ["future_secret"];
  future.match.frames[0].payload.opponentHand.forEach((card) => { card.cardNumber = "private_hand"; });
  future.match.frames.push({ sequence: 2, payload: { ...structuredClone(future.match.frames[0].payload), turnNo: 2,
    opponentDiscard: [{ cardNumber: "future_secret" }] } });
  const after = analyzeReplayDecisions(future, { opponentModel: model(), seed: 23 }).analyses[0];
  assert.deepEqual(first, after);
  assert.equal(JSON.stringify(after.hiddenInformation).includes("private_hand"), false);
});

test("budget limits and unsupported windows produce an explicit experimental abstention", () => {
  const obs = observation(document());
  const limited = searchInformationSet(obs, obs.legalActions, baseline(obs), { maxNodes: 1, validationNodes: 1, opponentModel: model() });
  assert.equal(limited.supported, false);
  assert.ok(limited.reasons.includes("information_line_library_incomplete"));
  const defense = structuredClone(obs);
  defense.kind = "defense";
  const skipped = searchInformationSet(defense, defense.legalActions, baseline(obs), { opponentModel: model() });
  assert.ok(skipped.reasons.includes("information_search_window_not_supported"));
});

test("the experimental tree does not depend on which action the player subsequently chose", () => {
  const first = document();
  const changed = structuredClone(first);
  changed.match.decisionEvents[0].choice.identifier = "2";
  const options = { opponentModel: model(), seed: 17 };
  assert.deepEqual(analyzeReplayDecisions(first, options).analyses[0].hiddenInformation,
    analyzeReplayDecisions(changed, options).analyses[0].hiddenInformation);
});

test("policy-sensitive rankings are reported instead of being presented as a stable recommendation", () => {
  const replay = document({ opponentHand: [{ cardNumber: "CardBack" }],
    playerHand: ["critical_strike_red", "wounding_blow_red", "wounding_blow_blue"].map((cardNumber, index) => ({ cardNumber, action: 3, actionData: String(index) })) });
  const hidden = analyzeReplayDecisions(replay, { opponentModel: model({ nimblism_red: 2, wounding_blow_blue: 1 }), seed: 23 }).analyses[0].hiddenInformation;
  assert.equal(hidden.stability.complete, true);
  assert.equal(hidden.stability.stableAcrossCoveredGroups, false);
  assert.ok(hidden.reasons.includes("opponent_scenarios_change_ranking"));
  assert.equal(hidden.affectsRecommendation, false);
});

test("prototype-shaped identifiers are rejected as model input and cannot corrupt public counts", () => {
  const state = observation(document({ opponentDiscard: [{ cardNumber: "__proto__" }] })).state;
  assert.equal(state.opponentKnowledge.lowerBoundCounts["__proto__"], 1);
  assert.equal({}.polluted, undefined);
  assert.equal(buildOpponentBelief(state).supported, false);
  const bad = JSON.parse('{"__proto__":2,"nimblism_red":2}');
  assert.equal(buildOpponentBelief(observation(document()).state, model(bad)).supported, false);
});

test("paired benchmarking keeps match clusters, seed repetitions and budget caps separate from release validation", () => {
  const obs = observation(document());
  const cases = [0, 1].map(() => ({ matchKey: "same-match", observation: obs, opponentModel: model() }));
  const report = compareInformationSearch(cases, { seeds: [17, 23] });
  assert.equal(report.cases, 2);
  assert.equal(report.distinctMatches, 1);
  assert.equal(report.coveredMatches, 1);
  assert.equal(report.runs, 4);
  assert.equal(report.budgetsRespected, true);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.strategicallyValidated, false);
  assert.equal(report.humanReviewed, false);
  assert.equal(report.seedStability.length, 1);
  assert.equal(report.seedStability[0].distinctSeeds, 2);
  assert.ok(report.results.every((row) => row.baselineNodes <= report.algorithmBudget && row.experimentalNodes <= report.algorithmBudget));
});

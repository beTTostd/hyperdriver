import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDecisionObservations, analyzeDecisionObservation } from "../lib/decision-analysis-core.js";
import { trainDecisionModels, splitLearningCorpus } from "../lib/decision-learning-training.js";
import { stateFeatures, actionFeatures, predictHumanChoice, learningDiagnostics, validLearningArtifact } from "../lib/decision-learning.js";
import { buildPracticeExercises, gradePracticeExercise } from "../lib/decision-practice-core.js";
import { compareLearnedGuidance } from "../lib/decision-search-benchmark.js";

const DAY = 86400000;
const START = Date.UTC(2026, 0, 1);
function observation(life = 32, observedAt = START + 300000) {
  const payload = {
    initialLoad: { gameFormat: "cc" }, turnNo: 1, turnPlayer: "1", otherPlayer: "2", playerAP: 1,
    opponentAP: 0, playerPitchCount: 0, opponentPitchCount: 0, playerHealth: life, opponentHealth: 40 - life,
    opponentDeckCount: 2, canPassPhase: true, turnPhase: { turnPhase: "A", caption: "Action" }, playerArse: [], opponentArse: [],
    playerEquipment: [{ cardNumber: "synthetic_hero", slot: "Hero", controller: "1" }],
    opponentEquipment: [{ cardNumber: "synthetic_opponent", slot: "Hero", controller: "2" }],
    playerHand: ["critical_strike_red", "wounding_blow_red", "wounding_blow_blue"].map((cardNumber, index) => ({ cardNumber, action: 3, actionData: String(index) })),
    opponentHand: [{ cardNumber: "CardBack" }],
  };
  return extractDecisionObservations({ schemaVersion: "0.3.0", match: { frames: [{ sequence: 1, receivedAt: new Date(observedAt).toISOString(), payload }],
    decisionEvents: [{ frameSequence: 1, choice: { action: "3", zone: "MYHAND", identifier: "2" } }] } })[0];
}
function corpus() {
  const rows = [];
  for (let period = 0; period < 3; period += 1) for (let index = 0; index < (period ? 20 : 40); index += 1) {
    const startedAt = START + period * 30 * DAY + (index + 1) * 3600000;
    rows.push({ playerKey: `player-${period}-${index % 10}`, matchKey: `match-${period}-${index}`,
      startedAt, completedAt: startedAt + 900000, outcome: Number(index % 2 === 0),
      observation: observation(index % 2 ? 8 : 32, startedAt + 300000) });
  }
  return rows;
}
const cuts = { trainUntil: START + 30 * DAY, validationUntil: START + 60 * DAY, synthetic: true };
const rows = corpus();
const trained = trainDecisionModels(rows, cuts);
const futureObservation = () => observation(32, trained.artifact.availableAfter + DAY);

test("learning separates player, match and time and purges late labels", () => {
  const input = [
    { playerKey: "repeat", matchKey: "early", startedAt: 1, completedAt: 2 },
    { playerKey: "repeat", matchKey: "later", startedAt: 21, completedAt: 22 },
    { playerKey: "train", matchKey: "late-label", startedAt: 8, completedAt: 11 },
    { playerKey: "valid", matchKey: "valid", startedAt: 11, completedAt: 12 },
  ];
  const split = splitLearningCorpus(input, { trainUntil: 10, validationUntil: 20 });
  assert.equal(split.purged, 2); assert.equal(split.train.length, 0);
  assert.deepEqual(split.validation.map((row) => row.matchKey), ["valid"]);
  assert.deepEqual(split.test.map((row) => row.matchKey), ["later"]);
  assert.throws(() => splitLearningCorpus([...input, { ...input[0], startedAt: 22, completedAt: 23 }], { trainUntil: 10, validationUntil: 20 }), /Inconsistent/);
});

test("training is reproducible and evaluates separate human-choice and observed-outcome targets", () => {
  assert.deepEqual(trainDecisionModels(rows, cuts), trained);
  assert.equal(trained.report.status, "trained_shadow");
  assert.equal(trained.report.releaseEligible, false);
  assert.equal(trained.report.metrics.weighting, "one_total_weight_per_match");
  assert.ok(trained.report.metrics.choice.test.logLoss < trained.report.metrics.choice.test.uniformLogLoss);
  assert.ok(trained.report.metrics.observedOutcome.test.brierScore < trained.report.metrics.observedOutcome.test.baselineBrier);
  assert.equal(trained.report.metrics.observedOutcome.test.reliability.length, 10);
  assert.equal(validLearningArtifact(trained.artifact), true);
  const small = trainDecisionModels(rows.slice(0, 10), cuts);
  assert.equal(small.artifact, null); assert.equal(small.report.status, "insufficient_data");
});

test("held-out labels cannot change fitted weights or validation temperature", () => {
  const changed = structuredClone(rows);
  for (const row of changed.filter((item) => item.startedAt >= cuts.validationUntil)) {
    row.outcome = 1 - row.outcome;
    row.observation.chosenAction = row.observation.legalActions.find((action) => action.identifier === "critical_strike_red");
  }
  const result = trainDecisionModels(changed, cuts);
  assert.deepEqual(result.artifact.choice.weights, trained.artifact.choice.weights);
  assert.deepEqual(result.artifact.outcome.weights, trained.artifact.outcome.weights);
  assert.equal(result.artifact.choice.temperature, trained.artifact.choice.temperature);
  assert.equal(result.artifact.outcome.temperature, trained.artifact.outcome.temperature);
  assert.notDeepEqual(result.report.metrics, trained.report.metrics);
  const flipped = trainDecisionModels(rows.map((row) => ({ ...row, outcome: 1 - row.outcome })), cuts);
  assert.deepEqual(flipped.artifact.choice.weights, trained.artifact.choice.weights);
});

test("feature whitelist excludes future results, identities, chosen action and private opponent cards", () => {
  const obs = futureObservation();
  const changed = structuredClone(obs);
  Object.assign(changed.state, { finalResult: "victory", userId: "secret", observedAt: 1 });
  Object.assign(changed.state.opponent, { hand: [{ identifier: "secret_card" }], result: "loss" });
  changed.chosenAction = obs.legalActions[0];
  assert.deepEqual(stateFeatures(changed), stateFeatures(obs));
  assert.deepEqual(actionFeatures(changed, obs.legalActions[1]), actionFeatures(obs, obs.legalActions[1]));
});

test("inference abstains on future artifacts, missing times, uncovered domains, effects and outliers", () => {
  const obs = futureObservation();
  assert.equal(predictHumanChoice(obs, trained.artifact).supported, true);
  const missing = structuredClone(obs); missing.state.observedAt = null;
  assert.ok(predictHumanChoice(missing, trained.artifact).reasons.includes("decision_time_not_known"));
  assert.ok(predictHumanChoice(rows[0].observation, trained.artifact).reasons.includes("learned_model_from_future"));
  const unseen = structuredClone(obs); unseen.state.matchup.hero = "different_hero";
  assert.ok(predictHumanChoice(unseen, trained.artifact).reasons.includes("learned_model_domain_not_covered"));
  const effects = structuredClone(obs); effects.state.own.hand[0].hasModifiers = true;
  assert.ok(predictHumanChoice(effects, trained.artifact).reasons.includes("learned_features_not_covered"));
  const outlier = structuredClone(obs); outlier.state.own.resources = 20;
  assert.ok(predictHumanChoice(outlier, trained.artifact).reasons.includes("learned_features_out_of_distribution"));
  const corrupted = structuredClone(trained.artifact); corrupted.choice.weights[0] += 1;
  assert.equal(validLearningArtifact(corrupted), false);
  assert.equal(learningDiagnostics(obs, corrupted).searchPriorEligible, false);
});

test("frequent human choice guides shadow exploration without supplying rewards or principal recommendation", () => {
  const obs = futureObservation();
  const opponentModel = { knownAtFrame: 1, hero: "synthetic_opponent", format: "cc", initialCounts: { nimblism_red: 2, wounding_blow_blue: 1 } };
  const baseline = analyzeDecisionObservation(obs, { opponentModel, seed: 17 });
  const learned = analyzeDecisionObservation(obs, { learningModel: trained.artifact, opponentModel, seed: 17 });
  const popular = [...learned.learning.humanChoice.actions].sort((a, b) => b.probability - a.probability)[0];
  assert.equal(popular.actionKey, obs.chosenAction.key);
  assert.notEqual(popular.actionKey, learned.bestAction.key);
  assert.equal(learned.bestAction.key, baseline.bestAction.key);
  assert.equal(learned.bestActionValue, baseline.bestActionValue);
  assert.equal(learned.learning.affectsRecommendation, false);
  assert.equal(learned.learning.observedOutcome.counterfactualValue, false);
  assert.equal(learned.hiddenInformation.guidance.applied, true);
  assert.equal(learned.hiddenInformation.guidance.outcomeModelUsedForSearch, false);
  assert.equal(learned.hiddenInformation.guidance.affectsReward, false);
  assert.ok(learned.hiddenInformation.search.workUnits <= 4096);
  const ablation = compareLearnedGuidance([{ matchKey: "new-independent-match", observation: obs, opponentModel }], trained.artifact, { seeds: [17, 23] });
  assert.equal(ablation.runs.length, 2); assert.equal(ablation.budgetsRespected, true);
  assert.equal(ablation.releaseEligible, false); assert.equal(ablation.modelId, trained.artifact.id);
});

test("private exercises withhold answer keys, group a hand once and accept equivalent lines", () => {
  const obs = futureObservation();
  const analysis = analyzeDecisionObservation(obs);
  const source = { replayId: 1, sourceMatchId: "source", startedAt: START, observation: obs, analysis };
  const prepared = buildPracticeExercises([source, { ...source }], "current");
  assert.equal(prepared.exercises.length, 1);
  assert.equal(prepared.evaluatedOpportunities, 1);
  const item = prepared.exercises[0];
  for (const key of ["analysis", "chosenAction", "bestAction", "score", "sequence", "regretScore"]) assert.equal(Object.hasOwn(item.exercise, key), false);
  assert.ok(item.exercise.actions.some((action) => action.label.includes("azul")));
  assert.equal(gradePracticeExercise(item, analysis.bestAction.key).withinTolerance, true);
  const evidence = gradePracticeExercise(item, analysis.bestAction.key).best;
  assert.ok(Math.abs(evidence.scoreTrace.reduce((sum, term) => sum + term.contribution, 0) - evidence.score) < 0.001);
  assert.equal(gradePracticeExercise(item, obs.chosenAction.key).withinTolerance, false);
  assert.equal(gradePracticeExercise(item, "invented"), null);
  const equivalent = structuredClone(item);
  equivalent.analysis.candidateSequences.find((line) => line.actionKey === obs.chosenAction.key).score = analysis.bestActionValue - 1;
  assert.equal(gradePracticeExercise(equivalent, obs.chosenAction.key).withinTolerance, true);
  assert.equal(buildPracticeExercises([{ ...source, analysis: { ...analysis, confidence: "low" } }], "current").exercises.length, 0);
  assert.equal(buildPracticeExercises([{ ...source, observation: { ...obs, dataQuality: "inferred" } }], "current").exercises.length, 0);
  assert.notEqual(buildPracticeExercises([source], "new").exercises[0].exercise.id, item.exercise.id);
});

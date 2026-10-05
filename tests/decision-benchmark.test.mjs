import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareDecisionBenchmark, evaluateDecisionBenchmark, wilsonInterval } from "../lib/decision-benchmark.js";

function example(hero, matchKey, playerKey, kind = "action") {
  return { matchKey, playerKey, observation: {
    ordinal: 1, dataQuality: "captured", stateFingerprint: `${hero}:${matchKey}`, kind,
    state: { matchup: { hero, opponentHero: "opponent" } }, legalActions: [{ key: "a" }, { key: "b" }], chosenAction: { key: "a" },
  } };
}

test("chooses heroes by distinct players and matches, not one prolific player's decisions", () => {
  const examples = [
    ...Array.from({ length: 40 }, (_, i) => example("prolific", `p${i}`, "one")),
    ...Array.from({ length: 4 }, (_, i) => example("diverse", `d${i}`, `player${i}`)),
    ...Array.from({ length: 3 }, (_, i) => example("balanced", `b${i}`, `player${i}`)),
  ];
  const benchmark = prepareDecisionBenchmark(examples);
  assert.deepEqual(benchmark.selectedHeroes, ["diverse", "balanced"]);
  assert.equal(benchmark.cases.length, 7);
  assert.equal(benchmark.complete, false);
  assert.equal(JSON.stringify(benchmark.cases).includes("matchKey"), false);
  assert.equal(JSON.stringify(benchmark.cases).includes("playerKey"), false);
});

test("round-robin sampling stratifies by kind and uses each match once", () => {
  const benchmark = prepareDecisionBenchmark([
    example("hero", "same", "p", "action"), example("hero", "same", "p", "defense"),
    example("hero", "other", "q", "defense"), example("hero", "third", "q", "pitch"),
  ], 3);
  assert.equal(benchmark.complete, true);
  assert.equal(benchmark.cases.length, 3);
  assert.deepEqual(benchmark.cases.map((item) => item.example.decisionKind), ["action", "defense", "pitch"]);
});

function review(reviewer, acceptedActionKeys = ["a"], extra = {}) {
  return { reviewer, acceptedActionKeys, legal: true, futureInformationUsed: false, explanationFaithful: true, ...extra };
}

let nextCaseId = 0;
function reviewedCase(confidence = "high") {
  return { id: `case-${nextCaseId++}`, reviews: [review("one"), review("two")], analysis: { confidence, marker: "good", bestAction: { key: "a" } } };
}

test("release requires 200 independent reviewed cases, mandatory checks and a Wilson lower bound above 90%", () => {
  const cases = Array.from({ length: 200 }, () => reviewedCase());
  assert.equal(evaluateDecisionBenchmark(cases).releaseEligible, false);
  const report = evaluateDecisionBenchmark(cases, { mandatoryScenariosPassed: true });
  assert.equal(report.releaseEligible, true);
  assert.ok(report.highConfidenceWilson95.lower >= 0.9);
  assert.equal(evaluateDecisionBenchmark(cases.slice(0, 199), { mandatoryScenariosPassed: true }).releaseEligible, false);
  assert.equal(wilsonInterval(0, 0), null);
  assert.ok(wilsonInterval(9, 10).lower < 0.9);
});

test("reviewer conflicts require an independent adjudicator, and rule or future-information violations block release", () => {
  const cases = Array.from({ length: 200 }, () => reviewedCase());
  cases[0].reviews[1] = review("two", ["b"]);
  let report = evaluateDecisionBenchmark(cases, { mandatoryScenariosPassed: true });
  assert.equal(report.disagreements, 1);
  assert.equal(report.unresolvedDisagreements, 1);
  assert.equal(report.releaseEligible, false);
  cases[0].adjudication = review("three");
  assert.equal(evaluateDecisionBenchmark(cases, { mandatoryScenariosPassed: true }).releaseEligible, true);
  cases[1].reviews[0].futureInformationUsed = true;
  assert.equal(evaluateDecisionBenchmark(cases, { mandatoryScenariosPassed: true }).releaseEligible, false);
});

test("abstentions and duplicate reviewers cannot count as validated recommendations", () => {
  const cases = [reviewedCase("low"), { ...reviewedCase(), reviews: [review("one"), review("one")] }];
  const report = evaluateDecisionBenchmark(cases);
  assert.equal(report.reviewed, 1);
  assert.equal(report.abstentions, 1);
  assert.equal(report.recommendations, 0);
  assert.equal(report.releaseEligible, false);
});

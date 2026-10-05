import { createHash } from "node:crypto";
import { publicDecisionDatasetExample } from "./decision-analysis-core.js";

// Inputs are explicitly supplied authorized examples, with pseudonymous cohort
// keys. This module never reads the database or expands replay collection.
export function prepareDecisionBenchmark(examples, target = 200) {
  const heroes = new Map();
  const groups = new Map();
  for (const example of examples) {
    const { observation, matchKey, playerKey } = example;
    const hero = observation?.state?.matchup?.hero;
    if (!hero || !matchKey || !playerKey || observation.dataQuality !== "captured"
      || !observation.chosenAction || observation.legalActions.length < 2) continue;
    const bucket = heroes.get(hero) ?? { hero, matches: new Set(), players: new Set(), decisions: 0 };
    bucket.matches.add(matchKey);
    bucket.players.add(playerKey);
    bucket.decisions += 1;
    heroes.set(hero, bucket);
    const key = `${hero}:${observation.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), example]);
  }
  const heroRanking = [...heroes.values()].map((bucket) => ({
    hero: bucket.hero, matches: bucket.matches.size, players: bucket.players.size, decisions: bucket.decisions,
  })).sort((a, b) => b.players - a.players || b.matches - a.matches || b.decisions - a.decisions || a.hero.localeCompare(b.hero));
  const selectedHeroes = heroRanking.slice(0, 2).map((bucket) => bucket.hero);
  const queues = [...groups.entries()].filter(([, entries]) => selectedHeroes.includes(entries[0].observation.state.matchup.hero))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entries]) => entries.sort((a, b) => a.matchKey.localeCompare(b.matchKey) || a.observation.ordinal - b.observation.ordinal));
  const usedMatches = new Set();
  const cases = [];
  while (cases.length < target && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      let example;
      while (queue.length && !example) {
        const candidate = queue.shift();
        if (!usedMatches.has(candidate.matchKey)) example = candidate;
      }
      if (!example || cases.length >= target) continue;
      usedMatches.add(example.matchKey);
      cases.push({
        id: createHash("sha256").update(`${example.matchKey}:${example.observation.stateFingerprint}`).digest("hex"),
        example: publicDecisionDatasetExample(example.observation),
        reviews: [],
        adjudication: null,
      });
    }
  }
  return { target, selectedHeroes, heroRanking, cases, complete: cases.length === target };
}

export function wilsonInterval(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + z * z / total;
  const center = (proportion + z * z / (2 * total)) / denominator;
  const radius = z * Math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator;
  return { lower: center - radius, upper: center + radius };
}

function validReview(review) {
  return review && typeof review.reviewer === "string" && review.reviewer.length > 0
    && Array.isArray(review.acceptedActionKeys) && review.acceptedActionKeys.length > 0
    && review.acceptedActionKeys.every((key) => typeof key === "string")
    && typeof review.legal === "boolean" && typeof review.futureInformationUsed === "boolean"
    && typeof review.explanationFaithful === "boolean";
}

// Recommendations and review judgments are separate: human acceptance is not
// inferred from final match results or from the evaluator's own score.
export function evaluateDecisionBenchmark(cases, { mandatoryScenariosPassed = false } = {}) {
  let reviewed = 0;
  let disagreements = 0;
  let unresolvedDisagreements = 0;
  let abstentions = 0;
  let recommendations = 0;
  let accepted = 0;
  let highConfidence = 0;
  let highConfidenceAccepted = 0;
  let violations = 0;
  for (const item of cases) {
    const reviews = (item.reviews ?? []).filter(validReview);
    const reviewers = new Set(reviews.map((review) => review.reviewer));
    if (reviewers.size < 2) continue;
    reviewed += 1;
    if (reviews.some((review) => !review.legal || review.futureInformationUsed || !review.explanationFaithful)) violations += 1;
    const overlap = reviews[0].acceptedActionKeys.filter((key) => reviews.every((review) => review.acceptedActionKeys.includes(key)));
    const conflict = overlap.length === 0;
    if (conflict) disagreements += 1;
    const adjudication = validReview(item.adjudication) && !reviewers.has(item.adjudication.reviewer) ? item.adjudication : null;
    if (conflict && !adjudication) unresolvedDisagreements += 1;
    if (adjudication && (!adjudication.legal || adjudication.futureInformationUsed || !adjudication.explanationFaithful)) violations += 1;
    const keys = conflict ? adjudication?.acceptedActionKeys ?? [] : overlap;
    const analysis = item.analysis;
    if (!analysis || analysis.confidence === "low" || !analysis.marker) { abstentions += 1; continue; }
    recommendations += 1;
    const recommendationAccepted = keys.includes(analysis.bestAction.key);
    if (recommendationAccepted) accepted += 1;
    if (analysis.confidence === "high") {
      highConfidence += 1;
      if (recommendationAccepted) highConfidenceAccepted += 1;
    }
  }
  const interval = wilsonInterval(highConfidenceAccepted, highConfidence);
  const distinctCases = new Set(cases.map((item) => item.id)).size;
  const independentCases = cases.every((item) => typeof item.id === "string" && item.id.length > 0) && distinctCases === cases.length;
  return {
    cases: cases.length, reviewed, disagreements, unresolvedDisagreements, abstentions, recommendations, accepted,
    coverage: reviewed ? recommendations / reviewed : 0,
    acceptance: recommendations ? accepted / recommendations : null,
    highConfidence, highConfidenceAccepted, highConfidenceWilson95: interval, violations,
    mandatoryScenariosPassed, independentCases,
    releaseEligible: mandatoryScenariosPassed && independentCases && cases.length >= 200 && reviewed === cases.length
      && unresolvedDisagreements === 0 && violations === 0 && (interval?.lower ?? 0) >= 0.9,
  };
}

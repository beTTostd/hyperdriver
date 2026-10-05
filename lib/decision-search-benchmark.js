import { performance } from "node:perf_hooks";
import { searchDecisionLines } from "./decision-turn-search.js";
import { searchInformationSet, INFORMATION_SEARCH_VERSION } from "./decision-information-search.js";
import { validLearningArtifact } from "./decision-learning.js";

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value) => value === null ? null : Math.round(value * 1000) / 1000;

// Offline, explicit input only. Paired simulation gains are not human strategic
// labels, and multiple seeds/decisions from a match are not independent matches.
export function compareInformationSearch(cases, { maxNodes = 4096, validationNodes = 2048, seeds = [17, 23, 71] } = {}) {
  if (!Array.isArray(cases) || cases.length > 200 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096
    || !Number.isInteger(validationNodes) || validationNodes < 1 || validationNodes > 4096
    || !Array.isArray(seeds) || seeds.length < 1 || seeds.length > 16 || seeds.some((seed) => !Number.isInteger(seed))) {
    throw new Error("Invalid search benchmark input or budget");
  }
  const results = [];
  for (const item of cases) {
    if (typeof item.matchKey !== "string" || !item.matchKey || item.matchKey.length > 160
      || !item.observation?.state || !/^[a-f0-9]{64}$/.test(item.observation.stateFingerprint)
      || !Array.isArray(item.observation.legalActions)) throw new Error("Invalid benchmark case");
    const obs = item.observation;
    for (const seed of seeds) {
      const started = performance.now();
      const baseline = searchDecisionLines(obs, obs.legalActions, { maxNodes });
      const baselineMs = performance.now() - started;
      const best = baseline.candidates.filter((candidate) => candidate.line)
        .sort((a, b) => b.line.score - a.line.score || a.actionKey.localeCompare(b.actionKey))[0];
      const informationStarted = performance.now();
      const experiment = searchInformationSet(obs, obs.legalActions, best?.line, {
        maxNodes, validationNodes, seed, opponentModel: item.opponentModel,
      });
      results.push({
        matchKey: item.matchKey, stateFingerprint: obs.stateFingerprint, seed,
        baselineComplete: baseline.supported, experimentalCoverageComplete: experiment.supported,
        stable: experiment.stability?.complete && experiment.stability.stableAcrossCoveredGroups || false,
        baselineNodes: baseline.stats.nodesVisited, experimentalNodes: experiment.search.workUnits,
        validationNodes: experiment.validation.workUnits,
        budgetsRespected: baseline.stats.nodesVisited <= maxNodes && experiment.search.workUnits <= maxNodes
          && experiment.validation.workUnits <= validationNodes,
        baselineMs: round(baselineMs), experimentalMs: round(performance.now() - informationStarted),
        meanGain: experiment.comparison && !experiment.comparison.conditionalOnCoveredScenarios ? experiment.comparison.meanGain : null,
        pairedScenarios: experiment.comparison?.pairedScenarios ?? 0, reasons: experiment.reasons,
        recommendedActionKey: experiment.recommendationActionKey,
      });
    }
  }
  const matches = new Map();
  for (const result of results) {
    if (result.meanGain === null || !result.experimentalCoverageComplete || !result.baselineComplete) continue;
    const match = matches.get(result.matchKey) ?? [];
    match.push(result.meanGain);
    matches.set(result.matchKey, match);
  }
  const matchGains = [...matches.values()].map(mean);
  const byCase = new Map();
  for (const result of results) {
    const key = JSON.stringify([result.matchKey, result.stateFingerprint]);
    const rows = byCase.get(key) ?? new Map();
    rows.set(result.seed, result);
    byCase.set(key, rows);
  }
  const seedStability = [...byCase.values()].map((rows) => {
    const runs = [...rows.values()];
    const recommendations = new Set(runs.map((row) => row.recommendedActionKey));
    return { matchKey: runs[0].matchKey, stateFingerprint: runs[0].stateFingerprint,
      distinctSeeds: runs.length, distinctRecommendations: recommendations.size,
      stableAcrossSeeds: recommendations.size === 1 && !recommendations.has(null)
        && runs.every((row) => row.experimentalCoverageComplete) };
  });
  return {
    version: INFORMATION_SEARCH_VERSION, scoreUnit: "heuristic_points",
    algorithmBudget: maxNodes, pairedValidationBudget: validationNodes, seeds,
    cases: cases.length, distinctMatches: new Set(cases.map((item) => item.matchKey)).size,
    coveredMatches: matches.size, runs: results.length,
    averageMatchGain: round(mean(matchGains)),
    positiveMatchGains: matchGains.filter((gain) => gain > 0).length,
    stableRuns: results.filter((result) => result.stable).length,
    completeRuns: results.filter((result) => result.experimentalCoverageComplete).length,
    budgetsRespected: results.every((result) => result.budgetsRespected),
    humanReviewed: false, releaseEligible: false, strategicallyValidated: false,
    limitations: ["simulation_only", "committed_action_lines_only", "assumed_defender_policies", "no_independent_human_review"],
    seedStability,
    results,
  };
}

// An ablation of exploration only: identical budgets, seeds and paired held-out
// defender scenarios. Outcomes stay aggregated by match, not by simulated seed.
export function compareLearnedGuidance(cases, learningModel, options = {}) {
  if (!validLearningArtifact(learningModel)) throw new Error("Invalid learned model");
  const { maxNodes = 4096, validationNodes = 2048, seeds = [17, 23, 71] } = options;
  // Reuse the benchmark's bounded input validation before doing the ablation.
  compareInformationSearch([], { maxNodes, validationNodes, seeds });
  if (!Array.isArray(cases) || cases.length > 200) throw new Error("Invalid ablation cases");
  const runs = [];
  for (const item of cases) {
    if (typeof item.matchKey !== "string" || !item.matchKey || item.matchKey.length > 160
      || !/^[a-f0-9]{64}$/.test(item.observation?.stateFingerprint) || !Array.isArray(item.observation?.legalActions)) throw new Error("Invalid ablation case");
    const obs = item.observation;
    const baseline = searchDecisionLines(obs, obs.legalActions, { maxNodes });
    const best = baseline.candidates.filter((candidate) => candidate.line).sort((a, b) => b.line.score - a.line.score || a.actionKey.localeCompare(b.actionKey))[0];
    for (const seed of seeds) {
      const parameters = { maxNodes, validationNodes, seed, opponentModel: item.opponentModel };
      const unguided = searchInformationSet(obs, obs.legalActions, best?.line, parameters);
      const guided = searchInformationSet(obs, obs.legalActions, best?.line, { ...parameters, learningModel });
      const pairedComplete = guided.supported && unguided.supported && guided.comparison && unguided.comparison
        && JSON.stringify(guided.validation.groups.map((group) => [group.archetype, group.policy, group.attempted, group.covered]))
          === JSON.stringify(unguided.validation.groups.map((group) => [group.archetype, group.policy, group.attempted, group.covered]));
      runs.push({ matchKey: item.matchKey, stateFingerprint: obs.stateFingerprint, seed, applied: guided.guidance.applied,
        pairedComplete: Boolean(pairedComplete), gain: pairedComplete ? round(guided.comparison.experimentalMeanScore - unguided.comparison.experimentalMeanScore) : null,
        guidedAction: guided.recommendationActionKey, unguidedAction: unguided.recommendationActionKey,
        guidedNodes: guided.search.workUnits, unguidedNodes: unguided.search.workUnits,
        budgetsRespected: [guided, unguided].every((result) => result.search.workUnits <= maxNodes && result.validation.workUnits <= validationNodes),
        reasons: guided.guidance.reasons });
    }
  }
  const matches = new Map();
  for (const run of runs.filter((item) => item.applied && item.pairedComplete)) {
    const values = matches.get(run.matchKey) ?? []; values.push(run.gain); matches.set(run.matchKey, values);
  }
  return { modelId: learningModel.id, mode: "shadow", scoreUnit: "heuristic_points", maxNodes, validationNodes, seeds,
    comparedMatches: matches.size, averageMatchGain: round(mean([...matches.values()].map(mean))),
    budgetsRespected: runs.every((run) => run.budgetsRespected), releaseEligible: false, strategicallyValidated: false,
    limitations: ["simulation_only", "human_frequency_not_optimality", "independent_strategic_review_required"], runs };
}

import { createHash } from "node:crypto";
import { decisionCardProfile, DECISION_CARD_CATALOG_VERSION } from "./decision-card-catalog.js";
import { ACTION_FEATURE_NAMES, STATE_FEATURE_NAMES, DECISION_FEATURE_VERSION, DECISION_LEARNING_VERSION,
  actionFeatures, stateFeatures, learningCandidates, learningDomain, dot, sigmoid, softmax } from "./decision-learning.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const log = (probability) => Math.log(Math.max(1e-9, Math.min(1 - 1e-9, probability)));
const bucket = (time, cuts) => time < cuts.trainUntil ? "train" : time < cuts.validationUntil ? "validation" : "test";

export function splitLearningCorpus(rows, cuts) {
  if (!Array.isArray(rows) || rows.length > 2000 || !Number.isFinite(cuts?.trainUntil)
    || !Number.isFinite(cuts?.validationUntil) || cuts.trainUntil >= cuts.validationUntil) throw new Error("Invalid corpus or temporal boundaries");
  const matches = new Map();
  const players = new Map();
  const order = { train: 0, validation: 1, test: 2 };
  for (const row of rows) {
    if (![row.playerKey, row.matchKey].every((key) => typeof key === "string" && key.length > 0 && key.length <= 160)
      || !Number.isFinite(row.startedAt) || !Number.isFinite(row.completedAt) || row.completedAt < row.startedAt) throw new Error("Invalid pseudonymous keys or match times");
    if (matches.has(row.matchKey) && matches.get(row.matchKey) !== row.startedAt) throw new Error("Inconsistent match time");
    matches.set(row.matchKey, row.startedAt);
    const partition = bucket(row.startedAt, cuts);
    const existing = players.get(row.playerKey);
    if (!existing || order[partition] > order[existing]) players.set(row.playerKey, partition);
  }
  const splits = { train: [], validation: [], test: [], purged: 0 };
  for (const row of rows) {
    const partition = bucket(row.startedAt, cuts);
    const labelBeforeBoundary = partition === "train" ? row.completedAt < cuts.trainUntil
      : partition === "validation" ? row.completedAt < cuts.validationUntil : true;
    if (players.get(row.playerKey) !== partition || !labelBeforeBoundary) splits.purged += 1;
    else splits[partition].push(row);
  }
  return splits;
}

function preparedRows(rows) {
  const prepared = [];
  for (const row of rows) {
    const obs = row.observation;
    const time = obs?.state?.observedAt ?? row.stateAt;
    if (obs?.dataQuality !== "captured" || !obs.state?.own || !obs.state?.opponent
      || !Array.isArray(obs.state.own.hand) || !Array.isArray(obs.state.own.arsenal)
      || !obs.state.matchup || !Number.isFinite(time) || time < row.startedAt || time > row.completedAt
      || !/^[a-f0-9]{64}$/.test(obs.stateFingerprint) || obs.state.own.hand.length > 8
      || ![obs.state.own.life, obs.state.opponent.life, obs.state.own.resources, obs.state.own.actionPoints].every(Number.isFinite)
      || [...obs.state.own.hand, ...obs.state.own.arsenal].some((card) => !decisionCardProfile(card.identifier) || card.hasModifiers || card.restricted)
      || obs.state.unsupportedPublicEffects
      || (row.outcome !== undefined && row.outcome !== 0 && row.outcome !== 1)) continue;
    const actions = learningCandidates(obs);
    const target = actions.findIndex((action) => action.key === obs.chosenAction?.key);
    if (!actions.length || target < 0 || obs.chosenAction?.members) continue;
    prepared.push({ ...row, observation: obs, actions: actions.map((action) => actionFeatures(obs, action)),
      state: stateFeatures(obs), target, domain: learningDomain(obs) });
  }
  const outcomes = new Map();
  const unique = new Map();
  for (const row of prepared) {
    const match = JSON.stringify([row.playerKey, row.matchKey]);
    if (row.outcome !== undefined) {
      if (outcomes.has(match) && outcomes.get(match) !== row.outcome) throw new Error("Inconsistent observed outcome");
      outcomes.set(match, row.outcome);
    }
    const key = JSON.stringify([row.playerKey, row.matchKey, row.observation.stateFingerprint]);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => a.startedAt - b.startedAt || a.playerKey.localeCompare(b.playerKey) || a.observation.stateFingerprint.localeCompare(b.observation.stateFingerprint));
}

function matchWeights(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.matchKey, (counts.get(row.matchKey) ?? 0) + 1);
  return rows.map((row) => 1 / counts.get(row.matchKey));
}

function fit(rows, size, kind, epochs) {
  const weights = Array(size).fill(0);
  const importance = matchWeights(rows);
  const normalizer = importance.reduce((sum, weight) => sum + weight, 0);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = Array(size).fill(0);
    rows.forEach((row, index) => {
      if (kind === "choice") {
        const probabilities = softmax(row.actions.map((features) => dot(weights, features)));
        row.actions.forEach((features, action) => features.forEach((value, feature) => {
          gradient[feature] += importance[index] * (probabilities[action] - Number(action === row.target)) * value;
        }));
      } else {
        const error = sigmoid(dot(weights, row.state)) - row.outcome;
        row.state.forEach((value, feature) => { gradient[feature] += importance[index] * error * value; });
      }
    });
    weights.forEach((value, index) => { weights[index] = value - 0.4 * (gradient[index] / normalizer + 0.001 * value); });
  }
  return weights;
}

function choiceMetrics(rows, weights, temperature = 1) {
  const importance = matchWeights(rows);
  const normalizer = importance.reduce((sum, value) => sum + value, 0);
  let loss = 0, accuracy = 0, baselineLoss = 0;
  rows.forEach((row, index) => {
    const probabilities = softmax(row.actions.map((features) => dot(weights, features)), temperature);
    loss -= importance[index] * log(probabilities[row.target]);
    accuracy += importance[index] * Number(probabilities.indexOf(Math.max(...probabilities)) === row.target);
    baselineLoss += importance[index] * Math.log(probabilities.length);
  });
  return { logLoss: loss / normalizer, accuracy: accuracy / normalizer, uniformLogLoss: baselineLoss / normalizer };
}

function outcomeMetrics(rows, weights, temperature, baselineProbability) {
  const importance = matchWeights(rows);
  const normalizer = importance.reduce((sum, weight) => sum + weight, 0);
  let brier = 0, loss = 0, baselineBrier = 0, baselineLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ weight: 0, forecast: 0, observed: 0 }));
  rows.forEach((row, index) => {
    const probability = sigmoid(dot(weights, row.state) / temperature);
    const weight = importance[index];
    brier += weight * (probability - row.outcome) ** 2;
    loss -= weight * (row.outcome ? log(probability) : log(1 - probability));
    baselineBrier += weight * (baselineProbability - row.outcome) ** 2;
    baselineLoss -= weight * (row.outcome ? log(baselineProbability) : log(1 - baselineProbability));
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.weight += weight; bin.forecast += weight * probability; bin.observed += weight * row.outcome;
  });
  const reliability = bins.map((bin, index) => ({ bin: index, matchWeight: bin.weight,
    forecast: bin.weight ? bin.forecast / bin.weight : null, observed: bin.weight ? bin.observed / bin.weight : null }));
  const ece = reliability.reduce((sum, bin) => sum + (bin.matchWeight ? bin.matchWeight / normalizer * Math.abs(bin.forecast - bin.observed) : 0), 0);
  return { brierScore: brier / normalizer, logLoss: loss / normalizer, baselineBrier: baselineBrier / normalizer,
    baselineLogLoss: baselineLoss / normalizer, expectedCalibrationError: ece, reliability };
}

const ranges = (vectors) => vectors[0].map((_, index) => [Math.min(...vectors.map((vector) => vector[index])), Math.max(...vectors.map((vector) => vector[index]))]);
const summary = (rows) => ({ decisions: rows.length, players: new Set(rows.map((row) => row.playerKey)).size, matches: new Set(rows.map((row) => row.matchKey)).size });

export function trainDecisionModels(corpus, { trainUntil, validationUntil, epochs = 120, synthetic = false } = {}) {
  if (!Array.isArray(corpus) || corpus.length > 2000) throw new Error("Invalid corpus size");
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 200) throw new Error("Invalid epoch budget");
  const prepared = preparedRows(corpus);
  const split = splitLearningCorpus(prepared, { trainUntil, validationUntil });
  const counts = Object.fromEntries(["train", "validation", "test"].map((key) => [key, summary(split[key])]));
  const outcomeRows = Object.fromEntries(["train", "validation", "test"].map((key) => [key, split[key].filter((row) => row.outcome === 0 || row.outcome === 1)]));
  const reasons = [];
  for (const key of ["train", "validation", "test"]) {
    if (counts[key].matches < (key === "train" ? 20 : 10) || counts[key].players < (key === "train" ? 5 : 3)) reasons.push(`${key}_corpus_too_small`);
    if (summary(outcomeRows[key]).matches < (key === "train" ? 20 : 10) || new Set(outcomeRows[key].map((row) => row.outcome)).size < 2) reasons.push(`${key}_outcome_labels_insufficient`);
  }
  const report = { version: DECISION_LEARNING_VERSION, featureVersion: DECISION_FEATURE_VERSION,
    partitions: counts, purged: split.purged, excluded: corpus.length - prepared.length,
    temporalBoundaries: { trainUntil, validationUntil }, corpus: synthetic ? "synthetic" : "explicit_authorized_input",
    epochBudget: epochs, reasons, status: reasons.length ? "insufficient_data" : "trained_shadow",
    releaseEligible: false, strategicallyValidated: false, metrics: null,
  };
  if (reasons.length) return { artifact: null, report };
  const choiceWeights = fit(split.train, ACTION_FEATURE_NAMES.length, "choice", epochs);
  const outcomeWeights = fit(outcomeRows.train, STATE_FEATURE_NAMES.length, "outcome", epochs);
  const importance = matchWeights(outcomeRows.train);
  const baselineProbability = outcomeRows.train.reduce((sum, row, index) => sum + row.outcome * importance[index], 0) / importance.reduce((sum, value) => sum + value, 0);
  const temperatures = [0.5, 0.75, 1, 1.5, 2, 3];
  const choiceTemperature = [...temperatures].sort((a, b) => choiceMetrics(split.validation, choiceWeights, a).logLoss - choiceMetrics(split.validation, choiceWeights, b).logLoss)[0];
  const outcomeTemperature = [...temperatures].sort((a, b) => outcomeMetrics(outcomeRows.validation, outcomeWeights, a, baselineProbability).logLoss - outcomeMetrics(outcomeRows.validation, outcomeWeights, b, baselineProbability).logLoss)[0];
  const choiceTest = choiceMetrics(split.test, choiceWeights, choiceTemperature);
  const outcomeTest = outcomeMetrics(outcomeRows.test, outcomeWeights, outcomeTemperature, baselineProbability);
  report.metrics = {
    choice: { validation: choiceMetrics(split.validation, choiceWeights, choiceTemperature), test: choiceTest },
    observedOutcome: { validation: outcomeMetrics(outcomeRows.validation, outcomeWeights, outcomeTemperature, baselineProbability),
      test: outcomeTest, rawTest: outcomeMetrics(outcomeRows.test, outcomeWeights, 1, baselineProbability) },
    weighting: "one_total_weight_per_match", calibration: "temperature_selected_on_validation_only",
  };
  const states = new Map();
  for (const row of split.train) {
    const key = JSON.stringify([row.domain, ...row.state.map((value) => Math.round(value * 5) / 5)]);
    const matches = states.get(key) ?? new Set(); matches.add(row.matchKey); states.set(key, matches);
  }
  const artifact = {
    version: DECISION_LEARNING_VERSION, featureVersion: DECISION_FEATURE_VERSION, cardCatalogVersion: DECISION_CARD_CATALOG_VERSION,
    mode: "shadow", availableAfter: Math.max(...prepared.map((row) => row.completedAt)),
    domains: [...new Set(split.train.map((row) => row.domain))].sort(),
    choice: { weights: choiceWeights, ranges: ranges(split.train.flatMap((row) => row.actions)), temperature: choiceTemperature,
      target: "observed_human_choice", independentTestImproved: choiceTest.logLoss < choiceTest.uniformLogLoss - 0.01 },
    outcome: { weights: outcomeWeights, ranges: ranges(outcomeRows.train.map((row) => row.state)), temperature: outcomeTemperature,
      baselineProbability, target: "observed_match_outcome", counterfactualValue: false },
    provenance: { corpusDigest: hash(prepared.map((row) => [row.playerKey, row.matchKey, row.startedAt, row.completedAt, row.actions, row.state, row.target, row.outcome])),
      synthetic, partitions: counts, temporalBoundaries: report.temporalBoundaries, strategicReviewPassed: false },
    frequentStates: [...states].map(([key, matches]) => ({ featureFingerprint: hash(key), matches: matches.size })).sort((a, b) => b.matches - a.matches).slice(0, 20),
    evaluation: report.metrics,
  };
  artifact.id = hash(artifact);
  return { artifact, report };
}

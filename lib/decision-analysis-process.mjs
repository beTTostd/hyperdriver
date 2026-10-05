import { analyzeReplayDecisions } from "./decision-analysis-core.js";
import { readFileSync, statSync } from "node:fs";
import { validLearningArtifact } from "./decision-learning.js";

function configuredLearningModel() {
  const path = process.env.HYPERDRIVER_DECISION_LEARNING_MODEL_FILE;
  if (!path) return undefined;
  try {
    if (statSync(path).size > 131072) return undefined;
    const artifact = JSON.parse(readFileSync(path, "utf8"));
    return validLearningArtifact(artifact) ? artifact : undefined;
  } catch { return undefined; }
}

process.once("message", ({ document, options }) => {
  try {
    const result = analyzeReplayDecisions(document, { ...options, learningModel: configuredLearningModel() });
    process.send({ ok: true, result }, () => process.disconnect());
  } catch {
    // Do not transmit raw replay data or error messages back through logs.
    process.send({ ok: false }, () => process.disconnect());
  }
});

import { readFileSync, writeFileSync } from "node:fs";
import { prepareDecisionBenchmark, evaluateDecisionBenchmark } from "../lib/decision-benchmark.js";

const [mode, input, output] = process.argv.slice(2);
if (!["prepare", "report"].includes(mode) || !input || !output || input === output) {
  throw new Error("Usage: node scripts/decision-benchmark.mjs prepare|report input.json output.json (distinct files)");
}
const supplied = JSON.parse(readFileSync(input, "utf8"));
const result = mode === "prepare"
  ? prepareDecisionBenchmark(supplied)
  : evaluateDecisionBenchmark(supplied.cases, { mandatoryScenariosPassed: supplied.mandatoryScenariosPassed === true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ mode, cases: mode === "prepare" ? result.cases.length : result.cases, complete: result.complete, releaseEligible: result.releaseEligible }));

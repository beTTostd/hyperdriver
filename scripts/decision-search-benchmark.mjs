import { readFile, writeFile } from "node:fs/promises";
import { compareInformationSearch, compareLearnedGuidance } from "../lib/decision-search-benchmark.js";
import { extractDecisionObservations } from "../lib/decision-analysis-core.js";

function syntheticCases(learning = false) {
  const cases = [];
  for (const life of [4, 5, 8, 20]) for (const handCount of [0, 1]) {
    const payload = {
      initialLoad: { gameFormat: "cc" }, turnNo: 1, turnPlayer: "1", otherPlayer: "2",
      playerAP: 1, opponentAP: 0, playerPitchCount: 0, opponentPitchCount: 0,
      playerHealth: 20, opponentHealth: life, opponentDeckCount: 3 - handCount,
      canPassPhase: true, turnPhase: { turnPhase: "A", caption: "Action" }, playerArse: [], opponentArse: [],
      playerEquipment: [{ cardNumber: learning ? "synthetic_hero" : "synthetic_local", slot: "Hero", controller: "1" }],
      opponentEquipment: [{ cardNumber: "synthetic_opponent", slot: "Hero", controller: "2" }],
      playerHand: ["critical_strike_red", "wounding_blow_red", "wounding_blow_blue"].map((cardNumber, index) => ({ cardNumber, action: 3, actionData: String(index) })),
      opponentHand: Array.from({ length: handCount }, () => ({ cardNumber: "CardBack" })),
    };
    const document = { schemaVersion: "0.3.0", match: { frames: [{ sequence: 1, receivedAt: "2026-09-30T00:00:00.000Z", payload }],
      decisionEvents: [{ frameSequence: 1, choice: { action: "3", zone: "MYHAND", identifier: "0" } }] } };
    cases.push({ matchKey: `synthetic-${life}-${handCount}`, observation: extractDecisionObservations(document)[0],
      opponentModel: { knownAtFrame: 1, hero: "synthetic_opponent", format: "cc", initialCounts: { nimblism_red: 2, wounding_blow_blue: 1 } } });
  }
  return cases;
}

const [input, output, modelPath] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/decision-search-benchmark.mjs synthetic|authorized-cases.json report.json");
const cases = input === "synthetic" ? syntheticCases(Boolean(modelPath)) : JSON.parse(await readFile(input, "utf8"));
const report = compareInformationSearch(cases);
if (modelPath) report.learningAblation = compareLearnedGuidance(cases, JSON.parse(await readFile(modelPath, "utf8")));
report.corpus = input === "synthetic" ? "synthetic_restricted_subproblems" : "explicit_authorized_input";
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ cases: report.cases, coveredMatches: report.coveredMatches,
  averageMatchGain: report.averageMatchGain, budgetsRespected: report.budgetsRespected,
  releaseEligible: report.releaseEligible }));

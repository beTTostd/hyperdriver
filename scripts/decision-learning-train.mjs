import { readFile, writeFile } from "node:fs/promises";
import { trainDecisionModels } from "../lib/decision-learning-training.js";
import { extractDecisionObservations } from "../lib/decision-analysis-core.js";

const DAY = 86400000;
const START = Date.UTC(2026, 0, 1);
function syntheticCorpus() {
  const rows = [];
  for (let period = 0; period < 3; period += 1) for (let index = 0; index < (period === 0 ? 60 : 20); index += 1) {
    const startedAt = START + period * 30 * DAY + (index + 1) * 3600000;
    const stateAt = startedAt + 300000;
    const life = index % 2 ? 8 : 32;
    const payload = {
      initialLoad: { gameFormat: "cc" }, turnNo: 1, turnPlayer: "1", otherPlayer: "2",
      playerAP: 1, opponentAP: 0, playerPitchCount: 0, opponentPitchCount: 0,
      playerHealth: life, opponentHealth: 40 - life, opponentDeckCount: 2, canPassPhase: true,
      turnPhase: { turnPhase: "A", caption: "Action" }, playerArse: [], opponentArse: [],
      playerEquipment: [{ cardNumber: "synthetic_hero", slot: "Hero", controller: "1" }],
      opponentEquipment: [{ cardNumber: "synthetic_opponent", slot: "Hero", controller: "2" }],
      playerHand: ["critical_strike_red", "wounding_blow_red", "wounding_blow_blue"].map((cardNumber, cardIndex) => ({ cardNumber, action: 3, actionData: String(cardIndex) })),
      opponentHand: [{ cardNumber: "CardBack" }],
    };
    const document = { schemaVersion: "0.3.0", match: {
      frames: [{ sequence: 1, receivedAt: new Date(stateAt).toISOString(), payload }],
      decisionEvents: [{ frameSequence: 1, choice: { action: "3", zone: "MYHAND", identifier: "2" } }],
    } };
    rows.push({ playerKey: `synthetic-player-${period}-${index % 10}`, matchKey: `synthetic-match-${period}-${index}`,
      startedAt, completedAt: startedAt + 900000, outcome: Number(life === 32), observation: extractDecisionObservations(document)[0] });
  }
  return { rows, trainUntil: START + 30 * DAY, validationUntil: START + 60 * DAY };
}

const [input, modelOutput, reportOutput, trainBoundary, validationBoundary] = process.argv.slice(2);
if (!input || !modelOutput || !reportOutput) throw new Error("Usage: node scripts/decision-learning-train.mjs synthetic|authorized-corpus.json model.json report.json [trainUntilISO validationUntilISO]");
const synthetic = input === "synthetic";
const corpus = synthetic ? syntheticCorpus() : { rows: JSON.parse(await readFile(input, "utf8")), trainUntil: Date.parse(trainBoundary), validationUntil: Date.parse(validationBoundary) };
const result = trainDecisionModels(corpus.rows, { trainUntil: corpus.trainUntil, validationUntil: corpus.validationUntil, synthetic });
await writeFile(modelOutput, `${JSON.stringify(result.artifact, null, 2)}\n`, { mode: 0o600 });
await writeFile(reportOutput, `${JSON.stringify(result.report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: result.report.status, partitions: result.report.partitions, releaseEligible: result.report.releaseEligible }));

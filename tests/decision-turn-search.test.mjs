import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeReplayDecisions, extractDecisionObservations } from "../lib/decision-analysis-core.js";
import { applyTurnStep, createTurnState, searchDecisionLines } from "../lib/decision-turn-search.js";
import { analyzeInSeparateProcess } from "../lib/decision-analysis-process.js";

function document(hand, options = {}) {
  const { equipment = [], choice = 0, ...payloadOptions } = options;
  return { schemaVersion: "0.3.0", match: {
    frames: [{ sequence: 1, payload: {
      turnNo: 1, turnPlayer: "1", otherPlayer: "2", playerAP: 1, opponentAP: 0,
      playerPitchCount: 0, playerHealth: 20, opponentHealth: 20, canPassPhase: true,
      turnPhase: { turnPhase: "A", caption: "Action" }, playerArse: [],
      playerEquipment: [{ cardNumber: "local_hero", slot: "Hero" }, ...equipment],
      playerHand: hand.map((cardNumber, index) => ({ cardNumber, action: 3, actionData: String(index) })),
      ...payloadOptions,
    } }], decisionEvents: [{ frameSequence: 1, choice: { action: "3", zone: "MYHAND", identifier: String(choice) } }],
  } };
}

function verify(observation, action) {
  let state = createTurnState(observation.state);
  state.stage = observation.kind === "defense" ? "defense" : observation.kind === "arsenal" ? "arsenal" : "action";
  for (const step of action.sequence) {
    assert.equal(step.resourcesBefore, state.resources);
    assert.equal(step.actionPointsBefore, state.actionPoints);
    state = applyTurnStep(state, step);
    assert.equal(step.resourcesAfter, state.resources);
    assert.equal(step.actionPointsAfter, state.actionPoints);
  }
  assert.deepEqual(state, action.endState);
  assert.ok(state.ended);
  assert.equal(action.heuristicScore, Math.round(action.scoreTrace.reduce((sum, term) => sum + term.contribution, 0) * 1000) / 1000);
}

test("plays Nimblism before the attack and finances the whole line using a distinct pitch card", () => {
  const replay = document(["nimblism_red", "critical_strike_red", "wounding_blow_blue"]);
  const result = analyzeReplayDecisions(replay);
  const analysis = result.analyses[0];
  assert.equal(analysis.confidence, "medium");
  assert.equal(analysis.bestAction.identifier, "nimblism_red");
  assert.equal(analysis.bestAction.decomposition.powerOffered, 8);
  assert.equal(analysis.bestAction.decomposition.expectedDamage, 0);
  assert.equal(analysis.bestAction.decomposition.resourcesPaid, 1);
  assert.deepEqual(analysis.bestAction.sequence.filter((step) => step.kind === "pitch").map((step) => step.identifier), ["wounding_blow_blue"]);
  assert.equal(analysis.bestAction.endState.actionPoints, 0);
  assert.equal(analysis.bestAction.endState.resources, 0);
  assert.equal(analysis.horizon, "end_of_turn");
  for (const action of [analysis.chosenAction, analysis.bestAction, ...analysis.alternatives]) verify(result.observations[0], action);
});

test("stacks eligible bonuses while retaining Nimblism across an ineligible expensive attack", () => {
  const replay = document(["nimblism_red", "brutal_assault_yellow", "critical_strike_red", "wounding_blow_blue"], {
    equipment: [{ cardNumber: "goliath_gauntlet", action: 3, actionData: "1" }, { cardNumber: "quick_clicks", action: 0, actionData: "2" }],
  });
  const result = analyzeReplayDecisions(replay, { maxNodes: 4096 });
  const best = result.analyses[0].bestAction;
  assert.equal(result.analyses[0].confidence, "medium");
  assert.equal(best.decomposition.powerOffered, 15);
  assert.equal(best.decomposition.resourcesPaid, 3);
  assert.equal(best.decomposition.equipmentSpent, 2);
  const resolutions = best.sequence.filter((step) => step.kind === "resolve");
  assert.equal(resolutions.find((step) => step.identifier === undefined && step.power === 7)?.power, 7);
  assert.ok(best.sequence.findIndex((step) => step.identifier === "nimblism_red") < best.sequence.findIndex((step) => step.identifier === "quick_clicks"));
  verify(result.observations[0], best);
});

test("duplicate physical copies may stack buffs but a pitched instance cannot subsequently be played", () => {
  const result = analyzeReplayDecisions(document(["nimblism_red", "nimblism_red", "critical_strike_red", "wounding_blow_blue"]));
  const best = result.analyses[0].bestAction;
  assert.equal(best.decomposition.powerOffered, 11);
  assert.equal(new Set(best.sequence.filter((step) => step.kind === "declare").map((step) => step.instance)).size, 3);
  verify(result.observations[0], best);
  const state = createTurnState(result.observations[0].state);
  const declared = applyTurnStep(state, { kind: "declare", instance: "HAND:2" });
  const pitched = applyTurnStep(declared, { kind: "pitch", instance: "HAND:3" });
  const resolved = applyTurnStep(pitched, { kind: "resolve" });
  assert.throws(() => applyTurnStep(resolved, { kind: "declare", instance: "HAND:3" }));
});

test("AP exhaustion, unpaid costs, activation conditions and full arsenal reject illegal transitions", () => {
  const observation = extractDecisionObservations(document(["critical_strike_red", "wounding_blow_blue"], {
    equipment: [{ cardNumber: "quick_clicks" }], playerArse: [{ cardNumber: "wounding_blow_red" }],
  }))[0];
  const state = createTurnState(observation.state);
  assert.throws(() => applyTurnStep(state, { kind: "declare", instance: "CHAR:1" }));
  assert.throws(() => applyTurnStep(state, { kind: "pitch", instance: "HAND:1" }));
  assert.throws(() => applyTurnStep(state, { kind: "arsenal", instance: "HAND:1" }));
  const pending = applyTurnStep(state, { kind: "declare", instance: "HAND:0" });
  assert.throws(() => applyTurnStep(pending, { kind: "resolve" }));
  assert.throws(() => applyTurnStep(pending, { kind: "end" }));
  const paid = applyTurnStep(pending, { kind: "pitch", instance: "HAND:1" });
  const resolved = applyTurnStep(paid, { kind: "resolve" });
  assert.throws(() => applyTurnStep(resolved, { kind: "declare", instance: "ARSENAL:0" }));
  const emptyArsenal = createTurnState(extractDecisionObservations(document(["wounding_blow_red", "wounding_blow_blue"]))[0].state);
  const saved = applyTurnStep(emptyArsenal, { kind: "arsenal", instance: "HAND:0" });
  assert.throws(() => applyTurnStep(saved, { kind: "declare", instance: "HAND:1" }));
});

test("blocking with equipment without blade break preserves its response-turn activation", () => {
  const replay = document(["brutal_assault_yellow", "wounding_blow_blue"], {
    turnPlayer: "2", playerAP: 0, turnPhase: { turnPhase: "D", caption: "Block" },
    equipment: [{ cardNumber: "goliath_gauntlet", action: 3, actionData: "1" }],
    activeChainLink: { attackingCard: { cardNumber: "wounding_blow_red", controller: "2" }, totalPower: 4, totalDefense: 0 },
  });
  const observation = extractDecisionObservations(replay)[0];
  let state = createTurnState(observation.state);
  state.stage = "defense";
  state = applyTurnStep(state, { kind: "block", instance: "CHAR:1" });
  assert.equal(state.equipmentSpent, 0);
  state = applyTurnStep(state, { kind: "response", incoming: 4, life: 20 });
  state = applyTurnStep(state, { kind: "declare", instance: "CHAR:1" });
  assert.equal(state.equipmentSpent, 1);
  state = applyTurnStep(state, { kind: "resolve" });
  state = applyTurnStep(state, { kind: "declare", instance: "HAND:0" });
  state = applyTurnStep(state, { kind: "pitch", instance: "HAND:1" });
  state = applyTurnStep(state, { kind: "resolve" });
  assert.equal(state.powerOffered, 7);
});

test("defense preserves an attack plan and a lethal unblocked line has no response", () => {
  const replay = document(["nimblism_blue", "wounding_blow_red"], {
    choice: 0, playerHealth: 10, turnPlayer: "2", playerAP: 0,
    turnPhase: { turnPhase: "D", caption: "Block" },
    activeChainLink: { attackingCard: { cardNumber: "wounding_blow_red", controller: "2" }, totalPower: 4, totalDefense: 0 },
  });
  const result = analyzeReplayDecisions(replay);
  const analysis = result.analyses[0];
  assert.equal(analysis.horizon, "known_hand_response_turn");
  assert.equal(analysis.confidence, "medium");
  assert.equal(analysis.bestAction.identifier, "nimblism_blue");
  assert.equal(analysis.bestAction.decomposition.lifePreserved, 2);
  assert.equal(analysis.bestAction.decomposition.powerOffered, 4);
  verify(result.observations[0], analysis.bestAction);
  const lethal = structuredClone(replay);
  lethal.match.frames[0].payload.playerHealth = 3;
  const observation = extractDecisionObservations(lethal)[0];
  const search = searchDecisionLines(observation, observation.legalActions);
  const passing = search.candidates.find((candidate) => candidate.actionKey.startsWith("pass:"));
  assert.equal(passing.line.endState.defeated, true);
  assert.equal(passing.line.sequence.some((step) => step.kind === "response"), false);
});

test("arsenal value uses the known funding hand instead of color", () => {
  const result = analyzeReplayDecisions(document(["nimblism_red", "wounding_blow_blue"], {
    choice: 0, turnPhase: { turnPhase: "ARS", caption: "Arsenal" }, playerAP: 0,
  }));
  const analysis = result.analyses[0];
  // Saving Nimblism supports a five-power line with the retained blue attack.
  assert.equal(analysis.bestAction.identifier, "nimblism_red");
  assert.equal(analysis.bestAction.decomposition.arsenalQuality, 5);
  assert.equal(analysis.chosenSequence.filter((step) => step.kind === "arsenal").length, 1);
  verify(result.observations[0], analysis.bestAction);
});

test("bounded search abstains, records its budget and remains reproducible", () => {
  const replay = document(["nimblism_red", "critical_strike_red", "wounding_blow_blue"]);
  const first = analyzeReplayDecisions(replay, { maxNodes: 1 });
  assert.deepEqual(first, analyzeReplayDecisions(replay, { maxNodes: 1 }));
  assert.equal(first.analyses[0].confidence, "low");
  assert.equal(first.analyses[0].search.nodesVisited, 1);
  assert.equal(first.analyses[0].search.budgetExhausted, true);
  assert.ok(first.analyses[0].uncertaintyReasons.includes("search_budget_exhausted"));
});

test("later observations cannot alter an earlier decision's search budget or result", () => {
  const replay = document([...Array(7).fill("nimblism_red"), "wounding_blow_red"]);
  const prefix = analyzeReplayDecisions(replay).analyses[0];
  const extended = structuredClone(replay);
  const frame = replay.match.frames[0];
  const event = replay.match.decisionEvents[0];
  extended.match.frames = Array.from({ length: 66 }, (_, index) => ({
    ...structuredClone(frame), sequence: index + 1,
    payload: { ...structuredClone(frame.payload), turnNo: index + 1 },
  }));
  extended.match.decisionEvents = Array.from({ length: 66 }, (_, index) => ({ ...event, frameSequence: index + 1 }));
  const result = analyzeReplayDecisions(extended);
  assert.deepEqual(result.analyses[0], prefix);
  assert.equal(result.analyses.at(-1).search.budget, 0);
  assert.equal(result.analyses.at(-1).confidence, "low");
  assert.ok(result.analyses.reduce((sum, analysis) => sum + analysis.search.nodesVisited, 0) <= result.methodology.totalSearchBudget);
});

test("exact enumeration oracle agrees for small plain-card turn subproblems", () => {
  const plain = [
    { id: "wounding_blow_red", cost: 0, attack: 4, pitch: 1 },
    { id: "wounding_blow_blue", cost: 0, attack: 2, pitch: 3 },
    { id: "critical_strike_red", cost: 1, attack: 5, pitch: 1 },
    { id: "brutal_assault_yellow", cost: 2, attack: 5, pitch: 2 },
  ];
  for (const resources of [0, 1, 2]) for (const a of plain) for (const b of plain) for (const c of plain) {
    const hand = [a, b, c];
    let exact = -Infinity;
    // One AP and no go again: at most one attack. Enumerate the allocation of
    // physical cards to attack, pitch, arsenal and retention independently.
    for (let attacking = -1; attacking < hand.length; attacking += 1) {
      for (let pitchMask = 0; pitchMask < 8; pitchMask += 1) {
        if (attacking < 0 && pitchMask) continue;
        if (attacking >= 0 && (pitchMask & (1 << attacking))) continue;
        const paid = attacking < 0 ? 0 : hand[attacking].cost;
        const pitched = hand.filter((_, i) => pitchMask & (1 << i));
        const gain = pitched.reduce((sum, card) => sum + card.pitch, 0);
        if (resources + gain < paid) continue;
        // An ordered payment exists only if the final pitched card was still
        // needed. This oracle enumerates allocations rather than search edges.
        if (pitched.length && !pitched.some((last) => resources + gain - last.pitch < paid)) continue;
        const retained = hand.filter((_, i) => i !== attacking && !(pitchMask & (1 << i)));
        for (let arsenalIndex = -1; arsenalIndex < retained.length; arsenalIndex += 1) {
          const saved = retained[arsenalIndex];
          const funding = retained.filter((_, i) => i !== arsenalIndex).reduce((sum, card) => sum + card.pitch, 0);
          const reserve = saved && saved.cost <= funding ? saved.attack : 0;
          const consumed = (attacking < 0 ? 0 : 1) + pitched.length;
          const score = (attacking < 0 ? 0 : hand[attacking].attack * 0.82) - consumed * 0.65 + reserve * 0.35 - (resources + gain - paid) * 0.1;
          exact = Math.max(exact, score);
        }
      }
    }
    const analysis = analyzeReplayDecisions(document(hand.map((card) => card.id), { playerPitchCount: resources })).analyses[0];
    assert.equal(analysis.confidence, "medium");
    assert.equal(analysis.bestAction.heuristicScore, Math.round(exact * 1000) / 1000);
  }
});

test("the separate process produces the same analysis and supports timeout and cancellation", async () => {
  const replay = document(["nimblism_red", "critical_strike_red", "wounding_blow_blue"]);
  assert.deepEqual(await analyzeInSeparateProcess(replay), analyzeReplayDecisions(replay));
  await assert.rejects(analyzeInSeparateProcess(replay, {}, { timeoutMs: 1 }), /timed out/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeInSeparateProcess(replay, {}, { signal: controller.signal }), /lease lost/);
  const runningController = new AbortController();
  const running = analyzeInSeparateProcess(replay, {}, { signal: runningController.signal });
  runningController.abort();
  await assert.rejects(running, /lease lost/);
});

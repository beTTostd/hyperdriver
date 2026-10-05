import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeReplayDecisions,
  canonicalDecisionFrames,
  extractDecisionObservations,
  legalActionsAtFrame,
  publicDecisionDatasetExample,
} from "../lib/decision-analysis-core.js";

function card(identifier, input, pitchValue, action = "3", extra = {}) {
  return {
    cardNumber: identifier,
    action,
    actionData: String(input),
    pitchValue,
    controller: "1",
    ...extra,
  };
}

function basePayload(overrides = {}) {
  return {
    turnNo: 1,
    turnPlayer: "1",
    otherPlayer: "2",
    turnPhase: { turnPhase: "A", caption: "Escolha uma ação" },
    havePriority: true,
    priorityPlayer: "1",
    canPassPhase: true,
    playerAP: 1,
    opponentAP: 0,
    playerPitchCount: 1,
    opponentPitchCount: 0,
    playerHealth: 20,
    opponentHealth: 20,
    playerDeckCount: 40,
    opponentDeckCount: 40,
    playerEquipment: [{ cardNumber: "local_hero", slot: "Hero", controller: "1" }],
    opponentEquipment: [{ cardNumber: "opponent_hero", slot: "Hero", controller: "2" }],
    playerHand: [
      card("critical_strike_red", 0, 1),
      card("wounding_blow_blue", 1, 3),
    ],
    opponentHand: [{ cardNumber: "CardBack" }, { cardNumber: "CardBack" }, { cardNumber: "CardBack" }, { cardNumber: "CardBack" }],
    playerArse: [],
    opponentArse: [],
    ...overrides,
  };
}

function capturedDocument({ payload = basePayload(), choice = { action: "3", zone: "MYHAND", identifier: "1" } } = {}) {
  return {
    schemaVersion: "0.3.0",
    match: {
      id: "11111111-1111-4111-8111-111111111111",
      frames: [{ sequence: 1, receivedAt: "2026-08-25T12:00:00.000Z", payload }],
      decisionEvents: [{ sequence: 1, frameSequence: 1, occurredAt: "2026-08-25T12:00:01.000Z", choice }],
    },
  };
}

test("recognizes action, pitch, reaction, arsenal, instant, defense and modal decisions", () => {
  const scenarios = [
    ["action", basePayload()],
    ["pitch", basePayload({ turnPhase: { turnPhase: "P", caption: "Pitch para pagar o custo" } })],
    ["reaction", basePayload({ turnPhase: { turnPhase: "A", caption: "Escolha uma reação" } })],
    ["arsenal", basePayload({ turnPhase: { turnPhase: "A", caption: "Escolha uma carta para o arsenal" } })],
    ["instant", basePayload({ turnPhase: { turnPhase: "A", caption: "Janela de instant" } })],
    ["defense", basePayload({
      turnPhase: { turnPhase: "D", caption: "Declare seus bloqueios" },
      playerHealth: 6,
      activeChainLink: {
        attackingCard: { cardNumber: "wounding_blow_red", controller: "2" },
        totalPower: 8,
        totalDefense: 0,
      },
    })],
  ];

  for (const [expected, payload] of scenarios) {
    const observations = extractDecisionObservations(capturedDocument({ payload }));
    assert.equal(observations.length, 1, expected);
    assert.equal(observations[0].kind, expected);
    assert.equal(observations[0].dataQuality, "captured");
  }

  const modalPayload = basePayload({
    turnPhase: { turnPhase: "BUTTONINPUT", caption: "Escolha uma opção" },
    playerHand: [],
    canPassPhase: false,
    playerInputPopUp: {
      active: true,
      options: [{ value: "alpha", label: "Alpha" }, { value: "beta", label: "Beta" }],
      form: { mode: 7 },
    },
  });
  const modal = analyzeReplayDecisions(capturedDocument({
    payload: modalPayload,
    choice: { action: "7", zone: "MODAL", identifier: "alpha" },
  }));
  assert.equal(modal.observations[0].kind, "modal");
  assert.equal(modal.analyses[0].confidence, "low");
  assert.equal(modal.analyses[0].marker, null);
  assert.equal(modal.status, "insufficient_data");
});

test("excludes restricted cards, zero actions and modal display modes from legal alternatives", () => {
  const actions = legalActionsAtFrame(basePayload({
    canPassPhase: false,
    playerHand: [
      card("legal_attack", 0, 1),
      card("not_clickable", 1, 2, "0"),
      card("restricted_attack", 2, 3, "3", { restriction: "You cannot play this." }),
    ],
    playerInputPopUp: {
      active: true,
      choiceOptions: "checkbox",
      form: { mode: 7 },
      options: [{ value: "alpha", label: "Alpha" }],
    },
  }));

  assert.deepEqual(actions.map((action) => action.identifier).sort(), ["alpha", "legal_attack"]);
  assert.equal(actions.some((action) => action.identifier === "checkbox"), false);
});

test("excludes Talishar undo and cancel controls from strategic alternatives", () => {
  const actions = legalActionsAtFrame(basePayload({
    canPassPhase: false,
    playerHand: [],
    playerPrompt: {
      buttons: [
        { mode: 10000, caption: "Cancel" },
        { mode: 10001, caption: "Undo Block" },
        { mode: 99, caption: "Pass" },
      ],
    },
    playerInputPopUp: {
      active: true,
      buttons: [{ mode: 42, caption: "Desfazer bloqueio" }],
    },
  }));

  assert.deepEqual(actions.map(({ actionCode, label }) => ({ actionCode, label })), [
    { actionCode: "99", label: "Pass" },
  ]);
});

test("does not charge the normal hand-consumption penalty when both players refill on T0", () => {
  const defensePayload = basePayload({
    turnNo: 0,
    turnPlayer: "2",
    turnPhase: { turnPhase: "D", caption: "Declare seus bloqueios" },
    playerHealth: 17,
    playerHand: [
      card("wounding_blow_red", 0, 1),
      card("wounding_blow_blue", 1, 3),
    ],
    activeChainLink: {
      attackingCard: { cardNumber: "wounding_blow_red", controller: "2" },
      totalPower: 4,
      totalDefense: 0,
    },
    playerPrompt: {
      buttons: [
        { mode: 10001, caption: "Undo Block" },
        { mode: 99, caption: "Pass" },
      ],
    },
  });
  const choice = { action: "3", zone: "MYHAND", identifier: "0" };
  const firstTurn = analyzeReplayDecisions(capturedDocument({ payload: defensePayload, choice }));
  const laterTurn = analyzeReplayDecisions(capturedDocument({
    payload: { ...defensePayload, turnNo: 1 },
    choice,
  }));
  const firstTurnAnalysis = firstTurn.analyses[0];
  const laterTurnAnalysis = laterTurn.analyses[0];

  assert.equal(firstTurn.observations[0].legalActions.some((action) => action.label === "Undo Block"), false);
  assert.equal(firstTurnAnalysis.bestAction.label === "Undo Block", false);
  assert.equal(firstTurnAnalysis.chosenAction.decomposition.cardsConsumed, 1);
  assert.equal(firstTurnAnalysis.chosenAction.decomposition.firstTurnCardsReplaced, 1);
  assert.equal(laterTurnAnalysis.chosenAction.decomposition.firstTurnCardsReplaced, 0);
  assert.equal(firstTurnAnalysis.chosenAction.utility, 2.7);
  assert.equal(laterTurnAnalysis.chosenAction.rootDecomposition.lifePreserved, 3);
  assert.equal(firstTurnAnalysis.regretScore, 0);
  assert.equal(firstTurnAnalysis.marker, null);
  assert.ok(firstTurnAnalysis.uncertaintyReasons.includes("first_turn_response_requires_unknown_draw"));
});

test("uses the form mode for modal card choices without a card play action", () => {
  const actions = legalActionsAtFrame(basePayload({
    canPassPhase: false,
    playerHand: [],
    playerInputPopUp: {
      active: true,
      choiceOptions: "checkbox",
      form: { mode: 77 },
      popup: {
        cards: [
          { cardNumber: "first_modal_card", actionData: "4" },
          { cardNumber: "second_modal_card", actionData: "9" },
        ],
      },
    },
  }));

  assert.deepEqual(actions.map(({ actionCode, identifier, input }) => ({ actionCode, identifier, input })), [
    { actionCode: "77", identifier: "first_modal_card", input: "4" },
    { actionCode: "77", identifier: "second_modal_card", input: "9" },
  ]);
});

test("represents a multi-card block as one sanitized chosen action", () => {
  const payload = basePayload({
    turnPhase: { turnPhase: "D", caption: "Declare seus bloqueios" },
    playerHealth: 5,
    playerHand: [
      card("wounding_blow_red", 0, 1),
      card("brutal_assault_yellow", 1, 2),
      card("wounding_blow_blue", 2, 3),
    ],
    activeChainLink: {
      attackingCard: { cardNumber: "wounding_blow_red", controller: "2" },
      totalPower: 9,
      totalDefense: 0,
    },
  });
  const result = analyzeReplayDecisions(capturedDocument({
    payload,
    choice: { action: "3", zone: "MYHAND", identifiers: ["0", "1"] },
  }));

  assert.equal(result.observations[0].chosenAction.source, "multi");
  assert.deepEqual(result.observations[0].chosenAction.identifiers, ["wounding_blow_red", "brutal_assault_yellow"]);
  assert.equal(result.analyses[0].decisionKind, "defense");
  assert.equal(result.analyses[0].chosenAction.rootDecomposition.cardsConsumed, 2);
});

test("drops decisions from an abandoned undo branch", () => {
  const original = basePayload({ turnNo: 1 });
  const abandoned = basePayload({ turnNo: 2, turnPhase: { turnPhase: "A", caption: "Abandoned action" } });
  const final = basePayload({ turnNo: 3, playerHealth: 19 });
  const document = {
    schemaVersion: "0.3.0",
    match: {
      frames: [
        { sequence: 1, payload: original },
        { sequence: 2, payload: abandoned },
        { sequence: 3, payload: structuredClone(original) },
        { sequence: 4, payload: final },
      ],
      decisionEvents: [{ frameSequence: 2, choice: { action: "3", zone: "MYHAND", identifier: "0" } }],
    },
  };

  assert.deepEqual(canonicalDecisionFrames(document.match.frames).map((entry) => entry.frameSequence), [3, 4]);
  assert.deepEqual(extractDecisionObservations(document), []);
});

test("maps a local player two replay without exposing the opponent hand", () => {
  const payload = basePayload({
    otherPlayer: "1",
    turnPlayer: "2",
    playerEquipment: [{ cardNumber: "player_two_hero", slot: "Hero", controller: "2" }],
    opponentEquipment: [{ cardNumber: "player_one_hero", slot: "Hero", controller: "1" }],
    opponentHand: [{ cardNumber: "secret_opponent_card", pitchValue: 3 }],
    opponentArse: [{ cardNumber: "secret_opponent_arsenal", facing: "DOWN" }],
    opponentBanish: [{ cardNumber: "secret_face_down_banish", facing: "DOWN" }],
  });
  const observation = extractDecisionObservations(capturedDocument({ payload }))[0];

  assert.equal(observation.state.localPlayer, "2");
  assert.equal(observation.state.isOwnTurn, true);
  assert.equal(observation.state.opponent.handCount, 1);
  assert.equal(JSON.stringify(observation.state).includes("secret_opponent_card"), false);
  assert.equal(JSON.stringify(observation.state).includes("secret_opponent_arsenal"), false);
  assert.equal(JSON.stringify(observation.state).includes("secret_face_down_banish"), false);
});

test("analyzes old replays only when the effective choice is safely inferable", () => {
  const before = basePayload();
  const removed = before.playerHand[0];
  const inferable = {
    schemaVersion: "0.1.0",
    match: {
      frames: [
        { sequence: 1, payload: before },
        { sequence: 2, payload: basePayload({
          playerHand: [before.playerHand[1]],
          playerPitch: [removed],
          playerPitchCount: 1,
        }) },
      ],
    },
  };
  const observations = extractDecisionObservations(inferable);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].dataQuality, "inferred");

  const incomplete = analyzeReplayDecisions({
    schemaVersion: "0.1.0",
    match: { frames: [{ sequence: 1, payload: basePayload() }] },
  });
  assert.equal(incomplete.status, "insufficient_data");
  assert.equal(incomplete.observations.length, 0);
});

test("future reveals and the final outcome cannot change an earlier evaluation", () => {
  const initial = capturedDocument();
  const withFuture = structuredClone(initial);
  withFuture.match.summary = { winner: "2" };
  withFuture.match.frames.push({
    sequence: 2,
    payload: basePayload({
      turnNo: 2,
      opponentDiscard: [{ cardNumber: "future_secret_reveal", pitchValue: 3, controller: "2" }],
      playerHealth: 1,
      opponentHealth: 20,
      turnPhase: { turnPhase: "OVER", caption: "Fim" },
    }),
  });

  const baseline = analyzeReplayDecisions(initial);
  const later = analyzeReplayDecisions(withFuture);
  assert.equal(later.observations[0].stateFingerprint, baseline.observations[0].stateFingerprint);
  assert.deepEqual(later.observations[0].state, baseline.observations[0].state);
  assert.equal(later.analyses[0].chosenActionValue, baseline.analyses[0].chosenActionValue);
  assert.equal(later.analyses[0].bestActionValue, baseline.analyses[0].bestActionValue);
  assert.equal(JSON.stringify(later.observations[0].state).includes("future_secret_reveal"), false);
  assert.equal(later.methodology.usesFinalResult, false);
});

test("collective examples omit account, replay and deck identifiers", () => {
  const observation = extractDecisionObservations(capturedDocument())[0];
  const example = publicDecisionDatasetExample(observation, {
    username: "private-user",
    sourceMatchId: "private-match-id",
    storageKey: "private-storage.json",
    deckLink: "https://fabrary.net/decks/private-deck",
    gameMode: "cc",
  });
  const serialized = JSON.stringify(example);

  assert.equal(example.observational, true);
  assert.equal(example.gameMode, "cc");
  for (const forbidden of ["private-user", "private-match-id", "private-storage", "private-deck"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("reports heuristic units and never manufactures a win probability", () => {
  const result = analyzeReplayDecisions(capturedDocument());
  const analysis = result.analyses[0];
  assert.equal(result.versions.analysisSchema, "5.0.0");
  assert.equal(result.methodology.primaryObjective, "heuristic_score");
  assert.equal(result.methodology.calibrated, false);
  assert.equal(analysis.scoreUnit, "heuristic_points");
  assert.equal(analysis.horizon, "end_of_turn");
  assert.equal(analysis.chosenAction.decomposition.chainContinuity, 0);
  assert.equal(analysis.bestAction.heuristicScore, 4.15);
  assert.equal(analysis.regretScore, 3.26);
  assert.equal(JSON.stringify(result).includes("estimatedWinProbability"), false);
});

test("detects actual excess block, including when no incoming damage remains", () => {
  for (const [power, defense, preserved, excess] of [[4, 0, 4, 2], [4, 4, 0, 6]]) {
    const payload = basePayload({
      turnPhase: { turnPhase: "D", caption: "Block" },
      playerHand: [card("wounding_blow_red", 0, 1), card("wounding_blow_blue", 1, 3)],
      activeChainLink: { attackingCard: { cardNumber: "wounding_blow_red" }, totalPower: power, totalDefense: defense },
    });
    const analysis = analyzeReplayDecisions(capturedDocument({ payload, choice: { action: "3", zone: "MYHAND", identifiers: ["0", "1"] } })).analyses[0];
    assert.equal(analysis.chosenAction.decomposition.rawBlock, 6);
    assert.equal(analysis.chosenAction.decomposition.lifePreserved, preserved);
    assert.equal(analysis.chosenAction.decomposition.overblock, excess);
    assert.ok(analysis.improvementTags.includes("overblock"));
    assert.equal(analysis.chosenAction.decomposition.cardsConsumed, 2);
    assert.ok(analysis.bestActionValue >= analysis.chosenActionValue);
    assert.ok(analysis.candidateSequences.some((candidate) => candidate.actionKey === analysis.chosenAction.key));
  }
});

test("enumerates equivalent composite candidates and preserves duplicate card instances", () => {
  const payload = basePayload({
    playerHealth: 4,
    turnPhase: { turnPhase: "D", caption: "Block" },
    playerHand: [card("wounding_blow_red", 0, 1), card("wounding_blow_red", 1, 1), card("wounding_blow_blue", 2, 3)],
    activeChainLink: { attackingCard: { cardNumber: "wounding_blow_red" }, totalPower: 8, totalDefense: 0 },
  });
  const analysis = analyzeReplayDecisions(capturedDocument({ payload, choice: { action: "3", zone: "MYHAND", identifiers: ["0", "1"] } })).analyses[0];
  assert.equal(analysis.candidateSequences.filter((candidate) => candidate.actionKey.startsWith("multi:")).length, 3);
  assert.equal(new Set(analysis.chosenAction.members.map((member) => member.key)).size, 2);
  assert.equal(analysis.chosenAction.rootDecomposition.lifePreserved, 6);
});

test("rejects partial, repeated and wrong-mode compound selections", () => {
  for (const choice of [
    { action: "3", zone: "MYHAND", identifiers: ["0", "missing"] },
    { action: "3", zone: "MYHAND", identifiers: ["0", "0"] },
    { action: "wrong", zone: "MYHAND", identifiers: ["0", "1"] },
    { action: "3", zone: "MYARSENAL", identifiers: ["0", "1"] },
  ]) {
    assert.equal(extractDecisionObservations(capturedDocument({ choice }))[0].chosenAction, null);
    assert.equal(analyzeReplayDecisions(capturedDocument({ choice })).analyses.length, 0);
  }
});

test("unknown cards and effects cause abstention despite an arbitrarily large score gap", () => {
  for (const overrides of [
    { playerHand: [card("unknown_red", 0, 1), card("wounding_blow_blue", 1, 3)] },
    { playerAuras: [{ cardNumber: "unknown_aura" }] },
    { playerHand: [card("critical_strike_red", 0, 1, "3", { countersMap: { attack: 1000 } }), card("wounding_blow_blue", 1, 3)] },
  ]) {
    const analysis = analyzeReplayDecisions(capturedDocument({ payload: basePayload(overrides) })).analyses[0];
    assert.equal(analysis.confidence, "low");
    assert.equal(analysis.marker, null);
    assert.ok(analysis.uncertaintyReasons.length > 0);
    assert.deepEqual(analysis.improvementTags, []);
  }
});

test("pitch is evaluated against the observed payment cost and abstains when it is absent", () => {
  const pitch = { turnPhase: { turnPhase: "P", caption: "Pitch" }, playerPitchCount: 0 };
  const lowCost = analyzeReplayDecisions(capturedDocument({ payload: basePayload({ ...pitch, playerPitchCost: 1 }) })).analyses[0];
  const highCost = analyzeReplayDecisions(capturedDocument({ payload: basePayload({ ...pitch, playerPitchCost: 5 }) })).analyses[0];
  const unknown = analyzeReplayDecisions(capturedDocument({ payload: basePayload(pitch) })).analyses[0];
  assert.equal(lowCost.chosenAction.decomposition.wastedPitch, 2);
  assert.equal(highCost.chosenAction.decomposition.wastedPitch, 0);
  assert.equal(highCost.bestAction.identifier, "wounding_blow_blue");
  assert.equal(unknown.confidence, "low");
  assert.equal(unknown.chosenAction.decomposition.wastedPitch, 0);
  assert.ok(unknown.uncertaintyReasons.includes("unknown_payment_cost"));
});

test("does not generate high confidence or causal deck signals from repeated heuristic decisions", () => {
  const document = capturedDocument();
  const original = document.match.frames[0];
  for (let index = 2; index <= 8; index += 1) {
    document.match.frames.push({ ...original, sequence: index, payload: { ...original.payload, turnNo: index } });
    document.match.decisionEvents.push({ frameSequence: index, choice: { action: "3", zone: "MYHAND", identifier: "1" } });
  }
  const result = analyzeReplayDecisions(document);
  assert.ok(result.analyses.length >= 3);
  assert.ok(result.analyses.every((analysis) => analysis.confidence !== "high"));
  assert.deepEqual(result.summary.deckSignals, []);
});

test("future revelations, final results and opponent private cards cannot change an earlier analysis", () => {
  const before = capturedDocument();
  const future = structuredClone(before);
  future.match.summary = { winner: "2" };
  future.match.frames.push({ sequence: 2, payload: basePayload({ turnNo: 2, opponentDiscard: [{ cardNumber: "future_reveal" }] }) });
  future.match.frames[0].payload.opponentHand = future.match.frames[0].payload.opponentHand.map(() => ({ cardNumber: "private_identity" }));
  assert.deepEqual(analyzeReplayDecisions(before).analyses[0], analyzeReplayDecisions(future).analyses[0]);
  const observation = extractDecisionObservations(future)[0];
  assert.equal(JSON.stringify(observation).includes("future_reveal"), false);
  assert.equal(JSON.stringify(observation).includes("private_identity"), false);
});

test("public copy counts are retained without counting repeated frames as new copies", () => {
  const payload = basePayload({ opponentPitch: [{ cardNumber: "wounding_blow_blue" }, { cardNumber: "wounding_blow_blue" }] });
  const document = capturedDocument({ payload });
  document.match.frames.push({ sequence: 2, payload: { ...payload, playerHealth: 19 } });
  document.match.decisionEvents.push({ frameSequence: 2, choice: { action: "3", zone: "MYHAND", identifier: "1" } });
  const observations = extractDecisionObservations(document);
  assert.equal(observations[0].state.opponentVisibleCardCounts.wounding_blow_blue, 2);
  assert.equal(observations[1].state.opponentVisibleCardCounts.wounding_blow_blue, 2);
});


test("unknown prototype property names cannot be mistaken for catalog entries", () => {
  const payload = basePayload({ playerHand: [card("constructor", 0, 1), card("__proto__", 1, 3)] });
  const analysis = analyzeReplayDecisions(capturedDocument({ payload })).analyses[0];
  assert.equal(analysis.confidence, "low");
  assert.ok(analysis.uncertaintyReasons.includes("card_not_in_catalog"));
});

test("face-down opponent chain cards and reactions remain private", () => {
  const payload = basePayload({ activeChainLink: {
    attackingCard: { cardNumber: "hidden_attacker", controller: "2", facing: "DOWN" },
    totalPower: 4, totalDefense: 0,
    reactions: [{ cardNumber: "hidden_reaction", controller: "2", facing: "DOWN" }],
  } });
  const state = extractDecisionObservations(capturedDocument({ payload }))[0].state;
  assert.equal(JSON.stringify(state).includes("hidden_attacker"), false);
  assert.equal(JSON.stringify(state).includes("hidden_reaction"), false);
});

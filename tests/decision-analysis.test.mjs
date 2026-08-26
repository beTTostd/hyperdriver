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
    playerPitchCount: 0,
    opponentPitchCount: 0,
    playerHealth: 20,
    opponentHealth: 20,
    playerDeckCount: 40,
    opponentDeckCount: 40,
    playerEquipment: [{ cardNumber: "local_hero", slot: "Hero", controller: "1" }],
    opponentEquipment: [{ cardNumber: "opponent_hero", slot: "Hero", controller: "2" }],
    playerHand: [
      card("strong_attack_red", 0, 1),
      card("resource_card_blue", 1, 3),
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
        attackingCard: { cardNumber: "opponent_attack", controller: "2" },
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
      card("dampen_red", 0, 1),
      card("conflicting_thoughts_blue", 1, 3),
    ],
    activeChainLink: {
      attackingCard: { cardNumber: "opponent_attack", controller: "2" },
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
  assert.equal(laterTurnAnalysis.chosenAction.utility, 1);
  assert.equal(firstTurnAnalysis.regretPp, 0);
  assert.equal(firstTurnAnalysis.marker, "good");
  assert.match(firstTurnAnalysis.explanation, /primeiro turno, ambos os jogadores compram até o intelecto/i);
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
      card("first_block", 0, 1),
      card("second_block", 1, 2),
      card("third_block", 2, 3),
    ],
    activeChainLink: {
      attackingCard: { cardNumber: "lethal_attack", controller: "2" },
      totalPower: 9,
      totalDefense: 0,
    },
  });
  const result = analyzeReplayDecisions(capturedDocument({
    payload,
    choice: { action: "3", zone: "MYHAND", identifiers: ["0", "1"] },
  }));

  assert.equal(result.observations[0].chosenAction.source, "multi");
  assert.deepEqual(result.observations[0].chosenAction.identifiers, ["first_block", "second_block"]);
  assert.equal(result.analyses[0].decisionKind, "defense");
  assert.equal(result.analyses[0].chosenAction.decomposition.cardsConsumed, 2);
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

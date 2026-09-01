import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compactDecisionChoice,
  compactReplayDocument,
  compactReplayPayload,
  indicators,
  isReplaySyncedToOrigin,
  markReplaySynced,
  markReplaySyncError,
  normalizeDeckLink,
  replaySyncProgress,
  replaySyncState,
  replayResult,
} from "../talishar-local-history/replay-state.js";

const betaOrigin = "https://beta.hyperdriver.com.br";
const productionOrigin = "https://hyperdriver.com.br";

test("compacts Talishar payloads to the state used by the replay", () => {
  const compacted = compactReplayPayload({
    chatLog: "mensagem privada e log completo",
    chatEnabled: true,
    newEvents: ["unused UI event"],
    initialLoad: {
      gameFormat: "cc",
      gameGUID: "game-guid-123",
      playerName: "  Drivér   One  ",
      opponentName: "Opponent Two",
      isOpponentAI: false,
      authKey: "never-store",
      deckLink: "https://fabrary.net/decks/private-deck#notes",
    },
    turnNo: 4,
    turnPlayer: "2",
    otherPlayer: "1",
    turnPhase: { turnPhase: "BUTTONINPUT", caption: "Escolha", extra: "descartar" },
    playerHealth: 18,
    playerEquipment: [{
      cardNumber: "dash_io",
      slot: "Hero",
      controller: "1",
      counters: 2,
      countersMap: { steam: 1 },
      tapped: false,
      secret: "não salvar",
    }],
    activeChainLink: {
      attackingCard: { cardNumber: "attack_red", controller: "1", private: "não salvar" },
      totalPower: 7,
      totalDefense: 3,
      attackTarget: "2",
      goAgain: true,
      private: "não salvar",
    },
  });

  assert.equal(compacted.chatLog, undefined);
  assert.equal(compacted.chatEnabled, undefined);
  assert.equal(compacted.newEvents, undefined);
  assert.deepEqual(compacted.initialLoad, {
    gameFormat: "cc",
    deckLink: "https://fabrary.net/decks/private-deck",
    gameGUID: "game-guid-123",
    playerName: "Drivér One",
    opponentName: "Opponent Two",
    isOpponentAI: false,
  });
  assert.equal(JSON.stringify(compacted).includes("never-store"), false);
  assert.equal(compacted.otherPlayer, "1");
  assert.deepEqual(compacted.turnPhase, { turnPhase: "BUTTONINPUT", caption: "Escolha" });
  assert.deepEqual(compacted.playerEquipment, [{
    cardNumber: "dash_io",
    slot: "Hero",
    controller: "1",
    counters: 2,
    countersMap: { steam: 1 },
    tapped: false,
  }]);
  assert.deepEqual(compacted.activeChainLink, {
    attackingCard: { cardNumber: "attack_red", controller: "1" },
    totalPower: 7,
    totalDefense: 3,
    attackTarget: "2",
    goAgain: true,
  });
});

test("keeps legal alternatives and effective choices through strict allowlists", () => {
  const compacted = compactReplayPayload({
    authKey: "never-store",
    playerID: "never-store",
    playerAP: 1,
    playerPitchCount: 2,
    canPassPhase: true,
    havePriority: true,
    playerHand: [{
      cardNumber: "command_and_conquer_red",
      action: 3,
      actionDataOverride: "0",
      pitchValue: 1,
      restriction: "",
      authKey: "never-store",
    }],
    playerPrompt: {
      buttons: [{ mode: 5, buttonInput: "MYHAND-0", caption: "Jogar carta", authKey: "never-store" }],
      authKey: "never-store",
    },
    playerInputPopUp: {
      active: true,
      multiChooseText: [{ value: "alpha", label: "Opção alpha", secret: "never-store" }],
      formOptions: { mode: 7, minNo: 1, maxNo: 2, caption: "Escolha", authKey: "never-store" },
    },
  });

  assert.deepEqual(compacted.playerHand, [{
    cardNumber: "command_and_conquer_red",
    action: 3,
    actionData: "0",
    pitchValue: 1,
  }]);
  assert.deepEqual(compacted.playerPrompt, {
    buttons: [{ mode: 5, buttonInput: "MYHAND-0", caption: "Jogar carta" }],
  });
  assert.deepEqual(compacted.playerInputPopUp, {
    active: true,
    options: [{ value: "alpha", label: "Opção alpha" }],
    form: { mode: 7, maxNo: 2, minNo: 1, caption: "Escolha" },
  });
  assert.equal(JSON.stringify(compacted).includes("never-store"), false);

  assert.deepEqual(compactDecisionChoice({
    action: 3,
    zone: "myhand",
    identifier: "0",
    identifiers: ["0", "1", "1", "unsafe value"],
    authKey: "never-store",
    body: "never-store",
    chat: "never-store",
  }), {
    action: "3",
    zone: "MYHAND",
    identifier: "0",
    identifiers: ["0", "1"],
  });
});

test("keeps only supported HTTPS deck links", () => {
  assert.equal(
    normalizeDeckLink("4<fav>https://www.fabdb.net/decks/build/private-deck#notes"),
    "https://www.fabdb.net/decks/build/private-deck",
  );
  assert.equal(normalizeDeckLink("javascript:alert(1)"), undefined);
  assert.equal(normalizeDeckLink("https://example.test/private-deck"), undefined);
  assert.equal(normalizeDeckLink("https://user:secret@fabrary.net/decks/private-deck"), undefined);
});

test("compacts imported replay envelopes as well", () => {
  const compacted = compactReplayDocument({
    schemaVersion: "0.1.0",
    chatLog: "não salvar no envelope",
    match: {
      id: "match-id",
      startedAt: "2026-08-20T12:00:00.000Z",
      chatLog: "não salvar na partida",
      frames: [{
        payload: { chatLog: "não salvar no frame", turnPhase: { turnPhase: "OVER" } },
      }],
    },
  });

  assert.deepEqual(Object.keys(compacted), ["schemaVersion", "match"]);
  assert.equal(compacted.match.chatLog, undefined);
  assert.equal(compacted.match.frames[0].payload.chatLog, undefined);
  assert.deepEqual(compacted.match.frames[0].payload.turnPhase, { turnPhase: "OVER" });
});

test("migrates legacy synchronization only to its recorded origin", () => {
  const legacy = {
    sync: {
      uploadedAt: "2026-08-20T12:00:00.000Z",
      origin: betaOrigin,
      username: "driver",
      replayId: "remote-id",
    },
    syncError: { at: "2026-08-20T12:01:00.000Z", message: "Falhou." },
  };

  const state = replaySyncState(legacy);
  assert.equal(state.targets[betaOrigin].replayId, "remote-id");
  assert.equal(state.targets[productionOrigin], undefined);
  assert.equal(state.errors[betaOrigin].message, "Falhou.");
  assert.equal(isReplaySyncedToOrigin(legacy, betaOrigin), true);
  assert.equal(isReplaySyncedToOrigin(legacy, productionOrigin), false);
});

test("tracks synchronization and errors independently per environment", () => {
  const match = {};
  markReplaySyncError(match, betaOrigin, "Beta indisponível.", "2026-08-20T12:00:00.000Z");
  markReplaySynced(match, productionOrigin, {
    username: "driver",
    replayId: "production-id",
  }, "2026-08-20T12:01:00.000Z");

  assert.equal(match.sync.errors[betaOrigin].message, "Beta indisponível.");
  assert.equal(match.sync.errors[productionOrigin], undefined);
  assert.equal(match.sync.targets[betaOrigin], undefined);
  assert.equal(match.sync.targets[productionOrigin].replayId, "production-id");
  assert.deepEqual(replaySyncProgress(match), { synced: 1, total: 2 });

  markReplaySynced(match, betaOrigin, {
    username: "driver",
    replayId: "beta-id",
  }, "2026-08-20T12:02:00.000Z");
  assert.equal(match.sync.errors[betaOrigin], undefined);
  assert.deepEqual(replaySyncProgress(match), { synced: 2, total: 2 });
});

test("reports popup synchronization progress for zero, one and two targets", () => {
  const match = {};
  assert.deepEqual(replaySyncProgress(match), { synced: 0, total: 2 });
  markReplaySynced(match, betaOrigin, {}, "2026-08-20T12:00:00.000Z");
  assert.deepEqual(replaySyncProgress(match), { synced: 1, total: 2 });
  markReplaySynced(match, productionOrigin, {}, "2026-08-20T12:01:00.000Z");
  assert.deepEqual(replaySyncProgress(match), { synced: 2, total: 2 });
});

test("identifies a lethal final attack as a player victory", () => {
  const replay = {
    frames: [{
      payload: {
        turnPhase: { turnPhase: "OVER" },
        playerHealth: "9",
        opponentHealth: "5",
        playerEquipment: [{ slot: "Hero", controller: "1" }],
        activeChainLink: {
          attackingCard: { controller: "1" },
          totalPower: 5,
          totalDefense: 0,
        },
      },
    }],
  };

  assert.equal(replayResult(replay), "victory");
});

test("does not treat the active turn player as the surrender winner", () => {
  const frame = (turnPlayer) => ({
    payload: {
      turnPhase: { turnPhase: "OVER" },
      playerHealth: "20",
      opponentHealth: "20",
      playerEquipment: [{ slot: "Hero", controller: "1" }],
      turnPlayer,
    },
  });

  assert.equal(replayResult({ frames: [frame("1")] }), "unknown");
  assert.equal(replayResult({ frames: [frame("2")] }), "unknown");
});

test("maps absolute winner and attack controllers to the local player", () => {
  const overFrame = (payload = {}, indicators = {}) => ({
    indicators,
    payload: {
      turnPhase: { turnPhase: "OVER" },
      playerHealth: "20",
      opponentHealth: "20",
      playerEquipment: [{ slot: "Hero", controller: "2" }],
      ...payload,
    },
  });

  assert.equal(replayResult({
    frames: [overFrame({}, { winner: "2" })],
  }), "victory");
  assert.equal(replayResult({
    frames: [overFrame({}, { winner: "1" })],
  }), "defeat");
  assert.equal(replayResult({ frames: [overFrame({ playerHealth: "0" })] }), "defeat");
  assert.equal(replayResult({ frames: [overFrame({
    opponentHealth: "5",
    activeChainLink: {
      attackingCard: { controller: "2" },
      totalPower: 5,
      totalDefense: 0,
    },
  })] }), "victory");
});

test("extracts the explicit Talishar winner without retaining chat", () => {
  const payload = {
    chatLog: "Player 1 conceded the game.<br><span>Player 2 won! 🎉</span>",
    turnPhase: { turnPhase: "OVER" },
  };

  assert.equal(indicators(payload).winner, "2");
  assert.equal(compactReplayPayload(payload).chatLog, undefined);
});

test("keeps incomplete final results unknown", () => {
  assert.equal(replayResult({
    frames: [{
      payload: {
        turnPhase: { turnPhase: "OVER" },
        playerHealth: "20",
        opponentHealth: "20",
      },
    }],
  }), "unknown");
});

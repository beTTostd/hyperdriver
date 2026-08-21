import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compactReplayDocument,
  compactReplayPayload,
  replayResult,
} from "../talishar-local-history/replay-state.js";

test("compacts Talishar payloads to the state used by the replay", () => {
  const compacted = compactReplayPayload({
    chatLog: "mensagem privada e log completo",
    chatEnabled: true,
    newEvents: ["unused UI event"],
    initialLoad: {
      gameFormat: "cc",
      playerName: "player",
      deckLink: "https://example.test/private-deck",
    },
    turnNo: 4,
    turnPlayer: "2",
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
  assert.deepEqual(compacted.initialLoad, { gameFormat: "cc" });
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

test("identifies a lethal final attack as a player victory", () => {
  const replay = {
    frames: [{
      payload: {
        turnPhase: { turnPhase: "OVER" },
        playerHealth: "9",
        opponentHealth: "5",
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

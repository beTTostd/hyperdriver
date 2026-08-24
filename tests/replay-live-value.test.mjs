import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateLiveReplayValue,
  replayTurnValue,
} from "../lib/replay-live-value.js";

const equipment = [{ cardNumber: "test_shield", slot: "Chest", controller: "1" }];

function frame(turnNo, turnPlayer, activeChainLink) {
  return {
    payload: {
      turnNo,
      turnPlayer,
      playerHealth: 20,
      playerEquipment: equipment,
      activeChainLink,
    },
  };
}

test("builds current-turn and match value from only the visible replay frames", () => {
  const frames = [
    frame(1, "1", {
      attackingCard: { cardNumber: "player_attack_red", controller: "1" },
      totalPower: 6,
      totalDefense: 2,
      reactions: [{ cardNumber: "opponent_guard_red", controller: "2" }],
    }),
    frame(1, "1", null),
    frame(2, "2", {
      attackingCard: { cardNumber: "opponent_attack_red", controller: "2" },
      totalPower: 8,
      totalDefense: 3,
      reactions: [{ cardNumber: "test_shield", controller: "1" }],
    }),
    frame(2, "2", null),
  ];

  const firstTurn = calculateLiveReplayValue(frames, 1);
  assert.equal(firstTurn.turnValue, 6);
  assert.equal(firstTurn.matchValue, 6);
  assert.equal(firstTurn.currentTurn.turn, "1");
  assert.equal(firstTurn.currentTurn.offeredDamage, 6);
  assert.equal(firstTurn.currentTurn.dealtDamage, 4);
  assert.equal(firstTurn.currentTurn.attackCardBlocked, 2);

  const secondTurn = calculateLiveReplayValue(frames, 3);
  assert.equal(secondTurn.turns.length, 2);
  assert.equal(secondTurn.currentTurn.turn, "2");
  assert.equal(secondTurn.currentTurn.receivedDamage, 5);
  assert.equal(secondTurn.currentTurn.equipmentBlocked, 3);
  assert.equal(secondTurn.currentTurn.dealtDamage, 5);
  assert.equal(secondTurn.currentTurn.attackEquipmentBlocked, 3);
  assert.equal(secondTurn.turnValue, 8);
  assert.equal(secondTurn.matchValue, 14);
  assert.equal(replayTurnValue(secondTurn.currentTurn), 8);
});

test("returns zero values before the replay has a visible frame", () => {
  assert.deepEqual(calculateLiveReplayValue([], 0), {
    turns: [],
    currentTurn: null,
    turnValue: 0,
    matchValue: 0,
  });
});

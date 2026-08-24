import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateUserStats } from "../lib/user-stats-core.js";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

function replay(userId, overrides = {}) {
  const value = (key, fallback) => Object.hasOwn(overrides, key) ? overrides[key] : fallback;
  const metadata = {
    id: value("id", 1),
    userId,
    sourceMatchId: value("sourceMatchId", `match-${userId}`),
    uploadedAt: value("uploadedAt", value("startedAt", NOW)),
    startedAt: value("startedAt", NOW),
    result: value("result", "victory"),
    gameMode: value("gameMode", "blitz"),
    playerHeroId: value("playerHeroId", "alpha_hero"),
    opponentHeroId: value("opponentHeroId", "beta_hero"),
    finalTurn: value("finalTurn", 4),
  };
  return {
    userId,
    metadata,
    document: value("document", { cycles: [] }),
  };
}

function stats(records, options = {}) {
  return aggregateUserStats(records, {
    userId: 7,
    now: NOW,
    period: "all",
    calculateTelemetry: (document) => document.cycles,
    ...options,
  });
}

test("calcula partidas, vitórias, derrotas, win rate e turnos médios", () => {
  const result = stats([
    replay(7, { result: "victory", finalTurn: 4 }),
    replay(7, { result: "defeat", finalTurn: 6 }),
    replay(7, { result: "unknown", finalTurn: null }),
  ]);

  assert.deepEqual(result.summary, {
    matches: 3,
    wins: 1,
    losses: 1,
    winRate: 50,
    averageTurns: 5,
  });
});

test("agrupa heróis e ignora heróis ausentes", () => {
  const result = stats([
    replay(7, { playerHeroId: "alpha_hero", result: "victory" }),
    replay(7, { playerHeroId: "alpha_hero", result: "defeat" }),
    replay(7, { playerHeroId: "beta_hero", result: "victory" }),
    replay(7, { playerHeroId: null, opponentHeroId: null }),
  ]);

  assert.deepEqual(result.heroes.map(({ hero, matches, wins, losses, winRate, participation }) => ({
    hero,
    matches,
    wins,
    losses,
    winRate,
    participation,
  })), [
    { hero: "alpha_hero", matches: 2, wins: 1, losses: 1, winRate: 50, participation: 50 },
    { hero: "beta_hero", matches: 1, wins: 1, losses: 0, winRate: 100, participation: 25 },
  ]);
});

test("mantém apenas matchups com pelo menos duas partidas", () => {
  const result = stats([
    replay(7, { opponentHeroId: "beta_hero", result: "victory" }),
    replay(7, { opponentHeroId: "beta_hero", result: "defeat" }),
    replay(7, { opponentHeroId: "rare_hero", result: "victory" }),
  ]);

  assert.deepEqual(result.matchups.map(({ opponent, matches, wins, losses, winRate }) => ({
    opponent,
    matches,
    wins,
    losses,
    winRate,
  })), [{ opponent: "beta_hero", matches: 2, wins: 1, losses: 1, winRate: 50 }]);
});

test("aplica o período e o modo selecionados", () => {
  const result = stats([
    replay(7, { startedAt: Date.parse("2026-08-21T10:00:00.000Z"), gameMode: "blitz" }),
    replay(7, { startedAt: Date.parse("2026-08-01T10:00:00.000Z"), gameMode: "cc" }),
    replay(7, { startedAt: Date.parse("2026-07-01T10:00:00.000Z"), gameMode: "blitz" }),
  ], { period: "30", mode: "blitz" });

  assert.equal(result.filters.period, "30");
  assert.equal(result.filters.mode, "blitz");
  assert.equal(result.summary.matches, 1);
  assert.equal(result.recentMatches.length, 1);
});

test("totaliza a telemetria e calcula médias por replay válido", () => {
  const result = stats([
    replay(7, {
      document: {
        cycles: [
          { receivedDamage: 4, equipmentBlocked: 1, cardBlocked: 2, offeredDamage: 8, lifeGained: 0 },
          { receivedDamage: 2, equipmentBlocked: 0, cardBlocked: 1, offeredDamage: 4, lifeGained: 2 },
        ],
      },
    }),
    replay(7, {
      document: {
        cycles: [{ receivedDamage: 2, equipmentBlocked: 3, cardBlocked: 0, offeredDamage: 6, lifeGained: 4 }],
      },
    }),
    replay(7, { document: { cycles: [] } }),
  ]);

  assert.deepEqual(result.telemetry.totals, {
    receivedDamage: 8,
    equipmentBlocked: 4,
    cardBlocked: 3,
    offeredDamage: 18,
    lifeGained: 6,
  });
  assert.deepEqual(result.telemetry.averages, {
    receivedDamage: 4,
    equipmentBlocked: 2,
    cardBlocked: 1.5,
    offeredDamage: 9,
    lifeGained: 3,
  });
  assert.equal(result.telemetry.validReplayCount, 2);
});

test("lista vazia retorna a estrutura completa e isola outro usuário", () => {
  const empty = stats([]);
  assert.equal(empty.summary.matches, 0);
  assert.deepEqual(empty.evolution, []);
  assert.deepEqual(empty.heroes, []);
  assert.deepEqual(empty.matchups, []);
  assert.equal(empty.telemetry.validReplayCount, 0);

  const isolated = stats([
    replay(8, { result: "victory", playerHeroId: "foreign_hero" }),
    replay(7, { result: "defeat", playerHeroId: "local_hero" }),
  ]);
  assert.equal(isolated.summary.matches, 1);
  assert.deepEqual(isolated.heroes.map(({ hero }) => hero), ["local_hero"]);
});

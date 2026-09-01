import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateEloChange,
  extractEloCandidate,
  normalizeTalisharNick,
} from "../lib/elo-core.js";

test("normalizes Talishar nicks with NFKC, collapsed spaces and case-insensitive identity", () => {
  assert.deepEqual(normalizeTalisharNick("  Ｄrivér\t ONE  "), {
    displayName: "Drivér ONE",
    normalizedName: "drivér one",
  });
  assert.equal(
    normalizeTalisharNick("ALICE").normalizedName,
    normalizeTalisharNick("alice").normalizedName,
  );
  assert.equal(normalizeTalisharNick(" \n "), null);
});

test("calculates classic Elo for equal players, favorites and underdogs with zero-sum changes", () => {
  const equal = calculateEloChange(1000, 1000);
  assert.equal(equal.change, 16);
  assert.equal(equal.winnerRating, 1016);
  assert.equal(equal.loserRating, 984);

  const favorite = calculateEloChange(1200, 1000);
  const underdog = calculateEloChange(1000, 1200);
  assert.ok(favorite.change < 16);
  assert.ok(underdog.change > 16);
  for (const calculation of [favorite, underdog]) {
    assert.ok(Math.abs(
      (calculation.winnerRating + calculation.loserRating) - 2200,
    ) < Number.EPSILON * 2200);
  }
});

test("extracts only eligible completed PvP identities with a known winner", () => {
  const document = eloDocument({ result: "victory" });
  const candidate = extractEloCandidate(document, "victory");
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.gameGuid, "guid-123");
  assert.equal(candidate.format, "cc");
  assert.equal(candidate.winner.normalizedName, "alice");
  assert.equal(candidate.loser.normalizedName, "bob");

  const ai = structuredClone(document);
  ai.match.frames[0].payload.initialLoad.isOpponentAI = true;
  assert.equal(extractEloCandidate(ai, "victory").eligible, false);
  assert.equal(extractEloCandidate(document, "unknown").eligible, false);

  for (const key of ["gameGUID", "playerName", "opponentName", "gameFormat"]) {
    const missing = structuredClone(document);
    delete missing.match.frames[0].payload.initialLoad[key];
    assert.equal(extractEloCandidate(missing, "victory").eligible, false, key);
  }
});

function eloDocument() {
  return {
    match: {
      frames: [{
        payload: {
          initialLoad: {
            gameGUID: "guid-123",
            playerName: "Alice",
            opponentName: "Bob",
            isOpponentAI: false,
            gameFormat: "CC",
          },
        },
      }],
    },
  };
}

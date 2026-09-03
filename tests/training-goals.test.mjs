import assert from "node:assert/strict";
import { test } from "node:test";
import { automaticGoalResult } from "../lib/training-goals-core.js";

test("freezes automatic goal outcome only at the target and respects the 25% boundary", () => {
  const below = automaticGoalResult({ baselineRate: 100, currentRate: 75.1, progressMatches: 10, targetMatches: 10 });
  assert.equal(below.complete, true);
  assert.equal(below.achieved, false);
  assert.ok(Math.abs(below.reduction - 0.249) < 1e-12);
  assert.deepEqual(
    automaticGoalResult({ baselineRate: 100, currentRate: 75, progressMatches: 10, targetMatches: 10 }),
    { complete: true, achieved: true, reduction: 0.25 },
  );
  assert.equal(automaticGoalResult({ baselineRate: 100, currentRate: 50, progressMatches: 9, targetMatches: 10 }).complete, false);
});

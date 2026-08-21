import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createKeyedTaskQueue,
  isValidImportedCandidate,
  matchesToPrune,
  MAX_STORED_MATCHES,
  MAX_TOTAL_BYTES,
} from "../talishar-local-history/extension-policy.js";

test("serializes capture tasks for the same match", async () => {
  const enqueue = createKeyedTaskQueue();
  const events = [];
  let releaseFirst;
  let markFirstStarted;
  const firstCanFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });

  const first = enqueue("match-a", async () => {
    events.push("first:start");
    markFirstStarted();
    await firstCanFinish;
    events.push("first:end");
  });
  const second = enqueue("match-a", async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await firstStarted;
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("validates imported replay identifiers, dates, frames and payloads", () => {
  const valid = {
    id: "4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01",
    startedAt: "2026-08-20T12:00:00.000Z",
    frames: [{ payload: { turnNo: 1 } }],
  };

  assert.equal(isValidImportedCandidate(valid), true);
  assert.equal(isValidImportedCandidate({ ...valid, id: "match-id" }), false);
  assert.equal(isValidImportedCandidate({ ...valid, startedAt: "invalid" }), false);
  assert.equal(isValidImportedCandidate({ ...valid, frames: [{}] }), false);
  assert.equal(isValidImportedCandidate({ ...valid, frames: [] }), false);
});

test("retention removes only old finished matches that have a safe copy", () => {
  const matches = Array.from({ length: MAX_STORED_MATCHES + 2 }, (_, index) => ({
    id: `match-${index}`,
    status: "finished",
    updatedAt: new Date(2026, 0, index + 1).toISOString(),
    exportedAt: index === 0 ? "2026-02-01T00:00:00.000Z" : null,
    sync: index === 1 ? { uploadedAt: "2026-02-01T00:00:00.000Z" } : null,
  }));

  assert.deepEqual(matchesToPrune(matches), ["match-0", "match-1"]);

  const withoutCopies = matches.map((match) => ({
    ...match,
    exportedAt: null,
    sync: null,
  }));
  assert.deepEqual(matchesToPrune(withoutCopies), []);
});

test("retention also enforces the total replay byte budget", () => {
  const matches = Array.from({ length: 6 }, (_, index) => ({
    id: `large-${index}`,
    status: "finished",
    updatedAt: new Date(2026, index, 1).toISOString(),
    exportedAt: "2026-08-20T12:00:00.000Z",
    capturedBytes: 40 * 1024 * 1024,
  }));

  assert.equal(matches.reduce((total, match) => total + match.capturedBytes, 0) > MAX_TOTAL_BYTES, true);
  assert.deepEqual(matchesToPrune(matches), ["large-0"]);
});

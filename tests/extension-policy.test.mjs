import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAppendCaptureFrame,
  captureGameId,
  captureMatchesGame,
  captureMatchesPage,
  createKeyedTaskQueue,
  isAllowedHttpsOrigin,
  isHyperdriverOrigin,
  isValidImportedCandidate,
  isTalisharOrigin,
  matchPagination,
  matchesToPrune,
  normalizeGameId,
  resumableCaptureForPage,
  MAX_STORED_MATCHES,
  MAX_TOTAL_BYTES,
  MATCHES_PER_PAGE,
} from "../talishar-local-history/extension-policy.js";

test("does not append repeated snapshots after a match is finished", () => {
  assert.equal(canAppendCaptureFrame({ status: "recording" }), true);
  assert.equal(canAppendCaptureFrame({ status: "finished" }), false);
});

test("associates a capture id with one Talishar game URL", () => {
  const match = { capture: { pageUrl: "/game/play/2026809" } };
  assert.equal(captureMatchesPage(match, "/game/play/2026809"), true);
  assert.equal(captureMatchesPage(match, "/game/play/2026810"), false);
});

test("resumes only the newest recording for the same Talishar game page", () => {
  const older = {
    id: "older",
    status: "recording",
    updatedAt: "2026-08-20T12:00:00.000Z",
    capture: { pageUrl: "/game/play/2026809" },
  };
  const newer = {
    id: "newer",
    status: "recording",
    updatedAt: "2026-08-20T12:01:00.000Z",
    capture: { pageUrl: "/game/play/2026809" },
  };
  const finished = {
    id: "finished",
    status: "finished",
    updatedAt: "2026-08-20T12:02:00.000Z",
    capture: { pageUrl: "/game/play/2026809" },
  };

  assert.equal(resumableCaptureForPage([older, finished, newer], "/game/play/2026809"), newer);
  assert.equal(resumableCaptureForPage([finished], "/game/play/2026809"), null);
  assert.equal(resumableCaptureForPage([newer], "/game/play/other"), null);
  assert.equal(resumableCaptureForPage([newer], "/game/create"), null);
});

test("uses Talishar gameGUID to separate matches across SPA route reuse", () => {
  const first = {
    status: "recording",
    updatedAt: "2026-09-07T14:00:00.000Z",
    capture: { pageUrl: "/game/create", gameId: "game-one" },
    frames: [],
  };
  const legacy = {
    status: "recording",
    updatedAt: "2026-09-07T14:01:00.000Z",
    capture: { pageUrl: "/game/create" },
    frames: [{ payload: { initialLoad: { gameGUID: "game-two" } } }],
  };

  assert.equal(normalizeGameId(" game-one "), "game-one");
  assert.equal(normalizeGameId("unsafe game"), null);
  assert.equal(captureGameId(legacy), "game-two");
  assert.equal(captureMatchesGame(first, "game-one"), true);
  assert.equal(captureMatchesGame(first, "game-two"), false);
  assert.equal(resumableCaptureForPage([first, legacy], "/game/create", "game-two"), legacy);
});

test("accepts only HTTPS origins inside the grouped Talishar and Hyperdriver domains", () => {
  assert.equal(isTalisharOrigin("https://talishar.net"), true);
  assert.equal(isTalisharOrigin("https://api.talishar.net"), true);
  assert.equal(isTalisharOrigin("https://replays.talishar.net"), true);
  assert.equal(isTalisharOrigin("http://api.talishar.net"), false);
  assert.equal(isTalisharOrigin("https://talishar.net.evil.example"), false);

  assert.equal(isHyperdriverOrigin("https://hyperdriver.com.br"), true);
  assert.equal(isHyperdriverOrigin("https://beta.hyperdriver.com.br"), true);
  assert.equal(isHyperdriverOrigin("https://staging.hyperdriver.com.br"), true);
  assert.equal(isHyperdriverOrigin("http://beta.hyperdriver.com.br"), false);
  assert.equal(isHyperdriverOrigin("https://hyperdriver.com.br.evil.example"), false);
  assert.equal(isAllowedHttpsOrigin("https://talishar.net", "hyperdriver.com.br"), false);
});

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

test("pagina históricos em grupos de cinco e corrige páginas fora do intervalo", () => {
  assert.equal(MAX_STORED_MATCHES, 10);
  assert.equal(MATCHES_PER_PAGE, 5);
  assert.deepEqual(matchPagination(0, 1), {
    page: 1,
    pageCount: 1,
    pageSize: 5,
    total: 0,
    offset: 0,
  });
  assert.equal(matchPagination(1, 1).pageCount, 1);
  assert.equal(matchPagination(5, 1).pageCount, 1);
  assert.equal(matchPagination(6, 1).pageCount, 2);
  assert.equal(matchPagination(10, 2).offset, 5);
  assert.deepEqual(matchPagination(13, 99), {
    page: 3,
    pageCount: 3,
    pageSize: 5,
    total: 13,
    offset: 10,
  });
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

test("retention protects a match synchronized with either environment", () => {
  const matches = Array.from({ length: MAX_STORED_MATCHES + 1 }, (_, index) => ({
    id: `match-${index}`,
    status: "finished",
    updatedAt: new Date(2026, 0, index + 1).toISOString(),
    sync: index === 0 ? {
      targets: {
        "https://beta.hyperdriver.com.br": { uploadedAt: "2026-02-01T00:00:00.000Z" },
      },
    } : null,
  }));

  assert.deepEqual(matchesToPrune(matches), ["match-0"]);
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

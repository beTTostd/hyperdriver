import assert from "node:assert/strict";
import { test } from "node:test";
import { createDownloadManager } from "../talishar-local-history/extension-download.js";

function replay(id, startedAt = "2026-09-07T12:00:00.000Z") {
  return { id, startedAt, schemaVersion: "0.6.0", frames: [{ payload: { turnNo: 0 } }] };
}

test("gera JSON compacto em Blob, inicia o download e revoga a URL", async () => {
  const notifications = [];
  const revoked = [];
  let generatedBlob;
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  const manager = createDownloadManager({
    loadMatch: async () => replay("4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01"),
    compactMatch: (match) => structuredClone(match),
    startDownload: async (url, filename) => {
      assert.equal(url, "blob:replay");
      assert.match(filename, /^talishar-history-.*\.json$/);
      return 42;
    },
    createObjectUrl: (blob) => {
      generatedBlob = blob;
      return "blob:replay";
    },
    revokeObjectUrl: (url) => revoked.push(url),
    notify: async (status) => {
      notifications.push(status);
      finish();
    },
    now: () => "2026-09-07T12:30:00.000Z",
  });

  assert.deepEqual(manager.enqueue("match-a", "job-a"), { jobId: "job-a", deduplicated: false });
  await finished;
  const serialized = await generatedBlob.text();
  assert.equal(serialized.includes("\n"), false);
  assert.equal(JSON.parse(serialized).exportedAt, "2026-09-07T12:30:00.000Z");
  assert.equal(notifications[0].status, "started");
  assert.equal(notifications[0].downloadId, 42);
  assert.deepEqual(revoked, ["blob:replay"]);
});

test("deduplica o mesmo replay e serializa downloads diferentes", async () => {
  let active = 0;
  let maximumActive = 0;
  const releases = [];
  const notifications = [];
  let finishAll;
  const allFinished = new Promise((resolve) => {
    finishAll = resolve;
  });
  const manager = createDownloadManager({
    loadMatch: async (id) => replay(id),
    compactMatch: (match) => match,
    startDownload: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return 1;
    },
    createObjectUrl: (_, index = 0) => `blob:${index}`,
    revokeObjectUrl: () => undefined,
    notify: async (status) => {
      notifications.push(status);
      if (notifications.length === 2) finishAll();
    },
  });

  assert.deepEqual(manager.enqueue("match-a", "job-a"), { jobId: "job-a", deduplicated: false });
  assert.deepEqual(manager.enqueue("match-a", "job-duplicate"), { jobId: "job-a", deduplicated: true });
  manager.enqueue("match-b", "job-b");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(releases.length, 1);
  releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(releases.length, 1);
  releases.shift()();
  await allFinished;
  assert.equal(maximumActive, 1);
  assert.deepEqual(notifications.map(({ jobId }) => jobId), ["job-a", "job-b"]);
});

test("restaura o fluxo após erro e ainda revoga o Blob", async () => {
  const notifications = [];
  const revoked = [];
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  const manager = createDownloadManager({
    loadMatch: async () => replay("match-a"),
    compactMatch: (match) => match,
    startDownload: async () => {
      throw new Error("Download recusado pelo Chrome.");
    },
    createObjectUrl: () => "blob:error",
    revokeObjectUrl: (url) => revoked.push(url),
    notify: async (status) => {
      notifications.push(status);
      finish();
    },
  });

  manager.enqueue("match-a", "job-a");
  await finished;
  assert.equal(notifications[0].status, "error");
  assert.equal(notifications[0].error, "Download recusado pelo Chrome.");
  assert.deepEqual(revoked, ["blob:error"]);
});

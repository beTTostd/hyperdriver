import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const utilitySource = readFileSync(
  `${projectRoot}/talishar-local-history/sync-content-script-utils.js`,
  "utf8",
);

function loadSyncHelpers() {
  const context = vm.createContext({});
  vm.runInContext(utilitySource, context);
  return context.__hyperdriverSync;
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("calculates simulated upload progress from completed replays", () => {
  const { progressPercentage } = loadSyncHelpers();

  assert.equal(progressPercentage(0, 3), 0);
  assert.equal(progressPercentage(1, 3), 33);
  assert.equal(progressPercentage(2, 3), 67);
  assert.equal(progressPercentage(3, 3), 100);
  assert.equal(progressPercentage(2, 0), 0);
});

test("recognizes only /replays as the list page eligible for reload", () => {
  const { isReplayLibraryPathname, shouldReload } = loadSyncHelpers();

  assert.equal(isReplayLibraryPathname("/replays"), true);
  assert.equal(isReplayLibraryPathname("/replays/"), false);
  assert.equal(isReplayLibraryPathname("/me"), false);
  assert.equal(isReplayLibraryPathname("/table/abc"), false);
  assert.equal(isReplayLibraryPathname("/telemetry/abc"), false);
  assert.equal(shouldReload("/replays", 1), true);
  assert.equal(shouldReload("/replays", 0, false, true), true);
  assert.equal(shouldReload("/replays", 0, false, true, true), false);
  assert.equal(shouldReload("/me", 1), false);
  assert.equal(shouldReload("/table/abc", 1), false);
  assert.equal(shouldReload("/telemetry/abc", 1), false);
  assert.equal(shouldReload("/replays", 1, true), false);
});

test("continues sequential uploads after a failed replay", async () => {
  const { synchronizePendingReplays } = loadSyncHelpers();
  const events = [];
  const progress = [];

  const result = await synchronizePendingReplays({
    ids: ["first", "failed", "last"],
    getReplay: async (id) => ({ document: { id } }),
    upload: async (document) => {
      events.push(`upload:${document.id}`);
      if (document.id === "failed") throw new Error("network failure");
      return response(201, { replayId: `remote-${document.id}`, username: "driver" });
    },
    markSynced: async (id) => events.push(`synced:${id}`),
    markError: async (id, message) => events.push(`error:${id}:${message}`),
    onProgress: (state) => progress.push({ phase: state.phase, percentage: state.percentage }),
  });

  assert.equal(result.uploaded, 2);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(events, [
    "upload:first",
    "synced:first",
    "upload:failed",
    "error:failed:Hyperdriver indisponível.",
    "upload:last",
    "synced:last",
  ]);
  assert.deepEqual(
    progress.filter(({ phase }) => phase !== "sending").map(({ percentage }) => percentage),
    [33, 67, 100],
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(
  `${projectRoot}/talishar-local-history/capture-session-utils.js`,
  "utf8",
);

function loadSessionHelpers() {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.__talisharCaptureSession;
}

test("reuses the local capture id when a completed game page is refreshed", () => {
  const { pageSessionId } = loadSessionHelpers();
  const existingId = "4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01";
  const stored = { id: existingId, pageUrl: "/game/play/2026809" };

  assert.equal(pageSessionId(stored, "/game/play/2026809", () => "new-id"), existingId);
});

test("creates a local capture id for a different Talishar game URL", () => {
  const { pageSessionId } = loadSessionHelpers();
  const stored = {
    id: "4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01",
    pageUrl: "/game/play/2026809",
  };

  assert.equal(pageSessionId(stored, "/game/play/2026810", () => "new-id"), "new-id");
});

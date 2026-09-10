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
const contentScriptSource = readFileSync(
  `${projectRoot}/talishar-local-history/content-script.js`,
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

test("recognizes only Talishar game routes", () => {
  const { gamePageUrl } = loadSessionHelpers();

  assert.equal(gamePageUrl("/"), null);
  assert.equal(gamePageUrl("/games"), null);
  assert.equal(gamePageUrl("/game"), "/game");
  assert.equal(gamePageUrl("/game/play/2026810"), "/game/play/2026810");
});

test("starts recording after SPA navigation from the Talishar home page", async () => {
  const listeners = new Map();
  const messages = [];
  const storage = new Map();
  const fixedId = "4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01";
  const sandbox = {
    TextEncoder,
    crypto: { randomUUID: () => fixedId },
    location: { pathname: "/", origin: "https://talishar.net" },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
      if (type === "message") this.messageListener = listener;
    },
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(JSON.parse(JSON.stringify(message)));
          return { ok: true, pageSessionId: message.pageSessionId };
        },
      },
      storage: {
        local: {
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  vm.runInContext(contentScriptSource, context);

  assert.equal(messages.length, 0, "the home page must not create an empty recording");
  context.location.pathname = "/game/play/2026810";
  vm.runInContext(`messageListener({
    source: window,
    origin: location.origin,
    data: {
      channel: "__talishar_local_history__",
      type: "sse-frame",
      endpoint: "/GetUpdateSSE.php",
      payload: JSON.stringify({ turnNo: 0 }),
    },
  })`, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(messages.map(({ type, pageUrl }) => ({ type, pageUrl })), [
    { type: "capture-session-start", pageUrl: "/game/play/2026810" },
    { type: "capture-frame", pageUrl: "/game/play/2026810" },
  ]);
  assert.equal(messages[1].pageSessionId, fixedId);
});

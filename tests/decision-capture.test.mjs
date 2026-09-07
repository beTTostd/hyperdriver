import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(
  `${projectRoot}/talishar-local-history/decision-capture-utils.js`,
  "utf8",
);
const bridgeSource = readFileSync(
  `${projectRoot}/talishar-local-history/page-bridge.js`,
  "utf8",
);

function loadHelpers() {
  const context = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(source, context);
  return context.__hyperdriverDecisionCapture;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadXhrBridge(responseText = "OK") {
  const messages = [];
  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = new Map();
      this.responseText = responseText;
      this.responseType = "";
      this.status = 200;
    }

    open(_method, url) {
      this.url = url;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    send(body) {
      this.body = body;
      this.listeners.get("load")?.call(this);
    }
  }
  const sandbox = {
    URL,
    URLSearchParams,
    XMLHttpRequest: FakeXMLHttpRequest,
    location: {
      href: "https://talishar.net/game/play/42",
      origin: "https://talishar.net",
    },
    postMessage(message, targetOrigin) {
      messages.push({ message: plain(message), targetOrigin });
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  vm.runInContext(bridgeSource, context);
  return { context, messages };
}

function loadFetchBridge({ ok = true, responseText = "OK" } = {}) {
  const messages = [];
  const sandbox = {
    URL,
    URLSearchParams,
    location: {
      href: "https://talishar.net/game/play/42",
      origin: "https://talishar.net",
    },
    async fetch() {
      return {
        ok,
        clone() {
          return { text: async () => responseText };
        },
      };
    },
    postMessage(message, targetOrigin) {
      messages.push({ message: plain(message), targetOrigin });
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  vm.runInContext(bridgeSource, context);
  return { context, messages };
}

test("captures only the allowlisted Talishar action fields from query requests", async () => {
  const { decisionFromRequest } = loadHelpers();
  const choice = await decisionFromRequest(
    "https://api.talishar.net/game/ProcessInput.php?gameName=secret-game&playerID=42&authKey=super-secret&mode=3&cardID=MYHAND-2&chat=private",
    {},
    "https://talishar.net/game/play/42",
  );

  assert.deepEqual(plain(choice), {
    action: "3",
    zone: "MYHAND",
    identifier: "2",
  });
  const serialized = JSON.stringify(choice);
  for (const forbidden of ["secret-game", "super-secret", "playerID", "authKey", "chat"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("sanitizes API submissions without retaining the raw request body", async () => {
  const { decisionFromRequest } = loadHelpers();
  const choice = await decisionFromRequest(
    "https://talishar.net/api/ProcessInputAPI.php",
    {
      body: JSON.stringify({
        gameName: "never-store",
        playerID: "17",
        authKey: "never-store-token",
        mode: "99",
        buttonInput: "MODAL-option_alpha",
        chat: "private message",
        submission: {
          selectedCards: ["card_alpha", "card_beta"],
          password: "never-store-password",
          arbitrary: ["not-allowed"],
        },
      }),
    },
    "https://talishar.net/game/play/17",
  );

  assert.deepEqual(plain(choice), {
    action: "99",
    zone: "MODAL",
    identifier: "option_alpha",
    identifiers: ["card_alpha", "card_beta"],
  });
  const serialized = JSON.stringify(choice);
  for (const forbidden of ["never-store", "private message", "password", "arbitrary"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("captures sanitized Talishar layer ordering identifiers", async () => {
  const { decisionFromRequest } = loadHelpers();
  const choice = await decisionFromRequest(
    "https://talishar.net/game/ProcessInputAPI.php",
    {
      body: JSON.stringify({
        mode: 10000,
        authKey: "never-store-token",
        submission: { layers: ["41", "17"], settings: { chat: "private" } },
      }),
    },
    "https://talishar.net/game/play/17",
  );

  assert.deepEqual(plain(choice), {
    action: "10000",
    identifiers: ["41", "17"],
  });
  assert.equal(JSON.stringify(choice).includes("never-store"), false);
  assert.equal(JSON.stringify(choice).includes("private"), false);
});

test("ignores non-action, insecure and non-Talishar requests", async () => {
  const { decisionFromRequest } = loadHelpers();
  for (const url of [
    "https://api.talishar.net/game/GetUpdateSSE.php?mode=3",
    "https://talishar.net/game/SubmitChat.php?mode=3",
    "http://talishar.net/game/ProcessInput.php?mode=3",
    "https://talishar.net.evil.example/ProcessInput.php?mode=3",
  ]) {
    assert.equal(await decisionFromRequest(url, {}, "https://talishar.net"), null, url);
  }
});

test("rejects unsafe action tokens instead of carrying arbitrary text", () => {
  const { choiceFromObject } = loadHelpers();
  assert.equal(choiceFromObject({ mode: "<script>alert(1)</script>", cardID: "MYHAND-1" }), null);
  assert.deepEqual(plain(choiceFromObject({ mode: 3, cardID: "MYHAND-1", authKey: "secret" })), {
    action: "3",
    zone: "MYHAND",
    identifier: "1",
  });
});

test("captures accepted fetch actions used by the current Talishar client", async () => {
  const { context, messages } = loadFetchBridge();
  await context.fetch(
    "https://api.talishar.net/game/ProcessInput.php?mode=3&cardID=1&authKey=never-store-token",
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].targetOrigin, "https://talishar.net");
  assert.deepEqual(messages[0].message.choice, {
    action: "3",
    identifier: "1",
  });
  assert.equal(JSON.stringify(messages[0]).includes("never-store"), false);
});

test("does not record failed or rejected fetch choices", async () => {
  for (const options of [{ ok: false }, { responseText: "Invalid action" }]) {
    const { context, messages } = loadFetchBridge(options);
    await context.fetch("https://talishar.net/game/ProcessInput.php?mode=3&cardID=1");
    assert.deepEqual(messages, []);
  }
});

test("records concession intent before Talishar redirects away from the game", async () => {
  const { context, messages } = loadFetchBridge({ ok: false });
  await context.fetch("https://talishar.net/game/ProcessInput.php?mode=100002&authKey=never-store");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].message, {
    channel: "__talishar_local_history__",
    type: "completion-event",
    reason: "concession",
    occurredAt: messages[0].message.occurredAt,
  });
  assert.equal(Number.isFinite(Date.parse(messages[0].message.occurredAt)), true);
  assert.equal(JSON.stringify(messages[0]).includes("never-store"), false);
});

test("records victory claimed over an inactive opponent as completion", async () => {
  const { context, messages } = loadFetchBridge();
  await context.fetch("https://talishar.net/game/ProcessInput.php?mode=100007");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.type, "completion-event");
  assert.equal(messages[0].message.reason, "claimed_victory");
});

test("captures accepted XMLHttpRequest actions without forwarding credentials or raw bodies", async () => {
  const { context, messages } = loadXhrBridge();
  const request = new context.XMLHttpRequest();
  request.open("POST", "https://api.talishar.net/game/ProcessInputAPI.php");
  request.send(JSON.stringify({
    mode: 3,
    cardID: "MYHAND-1",
    gameName: "never-store-game",
    playerID: "7",
    authKey: "never-store-token",
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].targetOrigin, "https://talishar.net");
  assert.deepEqual(messages[0].message.choice, {
    action: "3",
    zone: "MYHAND",
    identifier: "1",
  });
  assert.equal(JSON.stringify(messages[0]).includes("never-store"), false);
});

test("does not record XMLHttpRequest choices rejected by Talishar", async () => {
  const { context, messages } = loadXhrBridge("Invalid action");
  const request = new context.XMLHttpRequest();
  request.open("GET", "https://api.talishar.net/game/ProcessInput.php?mode=3&cardID=MYHAND-1&authKey=never-store");
  request.send();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(messages, []);
});

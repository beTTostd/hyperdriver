const DATABASE_NAME = "talishar-local-history";
const DATABASE_VERSION = 1;
const STORE_NAME = "matches";
const SCHEMA_VERSION = "0.1.0";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("startedAt", "startedAt");
      store.createIndex("status", "status");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

const getMatch = (id) => withStore("readonly", (store) => store.get(id));
const putMatch = (match) => withStore("readwrite", (store) => store.put(match));
const deleteMatch = (id) => withStore("readwrite", (store) => store.delete(id));

async function listMatches() {
  return withStore("readonly", (store) => store.getAll());
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));

  const cleaned = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(authkey|auth_key|token|cookie|password|sessionid|session_id)$/i.test(key)) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = sanitize(item, seen);
    }
  }
  return cleaned;
}

function parseAndSanitize(raw) {
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { rawText: raw.replace(/([?&](?:authKey|token)=[^&\s]+)/gi, "$1[REDACTED]") };
  }
}

function findFirstByKey(value, keys, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstByKey(item, keys, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase()) && (typeof item === "string" || typeof item === "number" || typeof item === "boolean")) return item;
    const found = findFirstByKey(item, keys, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function indicators(payload) {
  return {
    turn: findFirstByKey(payload, ["turn", "turnnumber", "currentturn"]),
    activePlayer: findFirstByKey(payload, ["activeplayer", "currentplayer", "playerturn"]),
    gameOver: findFirstByKey(payload, ["gameover", "gameended", "matchended"]),
    winner: findFirstByKey(payload, ["winner", "winningplayer"])
  };
}

function isFinished(indicator) {
  return indicator.gameOver === true || indicator.gameOver === "true" || indicator.gameOver === 1;
}

function makeMatch(pageSessionId, startedAt, pageUrl) {
  return {
    id: pageSessionId,
    schemaVersion: SCHEMA_VERSION,
    capture: {
      source: "Talishar Local History",
      startedAt,
      pageUrl,
      privacy: "Local-only. Authentication fields are redacted before storage."
    },
    status: "recording",
    startedAt,
    updatedAt: startedAt,
    endedAt: null,
    result: null,
    frames: [],
    summary: {
      turn: null,
      activePlayer: null,
      winner: null
    },
    exportedAt: null
  };
}

async function ensureMatch(message) {
  const existing = await getMatch(message.pageSessionId);
  if (existing) return existing;
  const match = makeMatch(message.pageSessionId, message.startedAt || new Date().toISOString(), message.pageUrl || "/");
  await putMatch(match);
  return match;
}

async function recordFrame(message) {
  const match = await ensureMatch(message);
  if (match.status === "finished") return;

  const payload = parseAndSanitize(message.payload);
  const indicator = indicators(payload);
  const frame = {
    sequence: match.frames.length + 1,
    receivedAt: message.receivedAt || new Date().toISOString(),
    endpoint: message.endpoint,
    indicators: indicator,
    payload
  };

  match.frames.push(frame);
  match.updatedAt = frame.receivedAt;
  match.summary = {
    turn: indicator.turn ?? match.summary.turn,
    activePlayer: indicator.activePlayer ?? match.summary.activePlayer,
    winner: indicator.winner ?? match.summary.winner
  };

  if (isFinished(indicator)) {
    match.status = "finished";
    match.endedAt = frame.receivedAt;
    match.result = indicator.winner ? "finished" : "unknown";
  }

  await putMatch(match);
  if (match.status === "finished") await exportMatch(match, true);
}

function fileName(match) {
  const date = (match.startedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `talishar-history-${date}-${match.id.slice(0, 8)}.json`;
}

async function exportMatch(match, automatic = false) {
  const exportDocument = {
    schemaVersion: match.schemaVersion,
    exportedAt: new Date().toISOString(),
    match
  };
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(exportDocument, null, 2))}`;
  await chrome.downloads.download({
    url,
    filename: `Talishar Local History/${fileName(match)}`,
    saveAs: false,
    conflictAction: "uniquify"
  });
  match.exportedAt = new Date().toISOString();
  await putMatch(match);
  return { automatic, filename: fileName(match) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message?.type) return;
    if (message.type === "capture-session-start") {
      await ensureMatch(message);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "capture-frame") {
      await recordFrame(message);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "list-matches") {
      const matches = (await listMatches()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      sendResponse({ ok: true, matches: matches.map((match) => ({
        id: match.id,
        status: match.status,
        startedAt: match.startedAt,
        updatedAt: match.updatedAt,
        endedAt: match.endedAt,
        frameCount: match.frames.length,
        summary: match.summary,
        exportedAt: match.exportedAt
      })) });
      return;
    }
    if (message.type === "export-match") {
      const match = await getMatch(message.id);
      if (!match) throw new Error("Partida não encontrada.");
      const result = await exportMatch(match);
      sendResponse({ ok: true, result });
      return;
    }
    if (message.type === "delete-match") {
      await deleteMatch(message.id);
      sendResponse({ ok: true });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

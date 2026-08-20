import { indicators, isCompleteMatch, isFinished, normalizeCompletion } from "./replay-state.js";

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

function gameMode(match) {
  const frame = match.frames.find((item) => {
    const value = item.payload?.initialLoad?.gameFormat;
    return typeof value === "string" && value.trim();
  });
  return frame?.payload?.initialLoad?.gameFormat?.trim().toLowerCase() || null;
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

function parseImportedMatch(raw) {
  const document = parseAndSanitize(raw);
  if (!document || typeof document !== "object" || Array.isArray(document) || "rawText" in document) {
    throw new Error("O arquivo não contém JSON válido.");
  }

  const candidate = document.match && typeof document.match === "object" && !Array.isArray(document.match)
    ? document.match
    : document;
  if (typeof candidate.id !== "string" || !candidate.id || !Array.isArray(candidate.frames) || candidate.frames.length === 0) {
    throw new Error("O JSON não parece ser um replay do Talishar.");
  }

  const match = {
    ...candidate,
    schemaVersion: candidate.schemaVersion || document.schemaVersion || SCHEMA_VERSION,
    status: candidate.status || "recording",
    frames: candidate.frames,
    summary: {
      turn: null,
      activePlayer: null,
      winner: null,
      ...(candidate.summary || {})
    },
    sync: null,
    syncError: null,
    exportedAt: candidate.exportedAt || document.exportedAt || null
  };
  return normalizeCompletion(match);
}

async function importMatch(raw) {
  const match = parseImportedMatch(raw);
  const existing = await getMatch(match.id);
  const existingIsCurrent = existing
    && existing.frames.length >= match.frames.length
    && (existing.status === "finished" || match.status !== "finished");
  if (existingIsCurrent) return { imported: false, id: match.id };
  await putMatch(match);
  return { imported: true, id: match.id };
}

async function requestSynchronization() {
  const tabs = await chrome.tabs.query({});
  const responses = await Promise.all(
    tabs
      .filter((tab) => tab.id != null)
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "sync-now" }).catch(() => null)),
  );
  return { requested: responses.filter((response) => response?.ok).length };
}

function makeMatch(pageSessionId, startedAt, pageUrl) {
  return {
    id: pageSessionId,
    schemaVersion: SCHEMA_VERSION,
    capture: {
      source: "Talishar Local History",
      startedAt,
      pageUrl,
      privacy: "Authentication fields are redacted before local storage or Hyperdriver synchronization."
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
  let pageSessionId = message.pageSessionId;
  const existing = await getMatch(pageSessionId);
  if (existing && existing.status !== "finished") return existing;
  if (existing?.status === "finished") pageSessionId = crypto.randomUUID();
  const match = makeMatch(pageSessionId, message.startedAt || new Date().toISOString(), message.pageUrl || "/");
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
}

function fileName(match) {
  const date = (match.startedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `talishar-history-${date}-${match.id.slice(0, 8)}.json`;
}

async function exportMatch(match) {
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
  return { filename: fileName(match) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message?.type) return;
    if (message.type === "capture-session-start") {
      const match = await ensureMatch(message);
      sendResponse({ ok: true, pageSessionId: match.id });
      return;
    }
    if (message.type === "capture-frame") {
      await recordFrame(message);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "import-match") {
      sendResponse({ ok: true, result: await importMatch(message.raw) });
      return;
    }
    if (message.type === "request-sync") {
      sendResponse({ ok: true, result: await requestSynchronization() });
      return;
    }
    if (message.type === "list-matches") {
      const matches = (await listMatches()).map(normalizeCompletion).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      await Promise.all(matches.filter((match) => match.status === "finished").map(putMatch));
      sendResponse({ ok: true, matches: matches.map((match) => ({
        id: match.id,
        status: match.status,
        startedAt: match.startedAt,
        updatedAt: match.updatedAt,
        endedAt: match.endedAt,
        frameCount: match.frames.length,
        gameMode: gameMode(match),
        summary: match.summary,
        exportedAt: match.exportedAt,
        sync: match.sync || null,
        syncError: match.syncError || null
      })) });
      return;
    }
    if (message.type === "list-sync-pending") {
      const matches = (await listMatches()).map(normalizeCompletion);
      await Promise.all(matches.filter((match) => match.status === "finished").map(putMatch));
      sendResponse({
        ok: true,
        ids: matches.filter((match) => match.status === "finished" && !match.sync?.uploadedAt).map((match) => match.id)
      });
      return;
    }
    if (message.type === "get-sync-match") {
      const match = await getMatch(message.id);
      if (!match || !isCompleteMatch(match) || match.sync?.uploadedAt) {
        sendResponse({ ok: true, document: null });
        return;
      }
      normalizeCompletion(match);
      await putMatch(match);
      sendResponse({
        ok: true,
        document: { schemaVersion: match.schemaVersion, exportedAt: new Date().toISOString(), match }
      });
      return;
    }
    if (message.type === "mark-match-synced") {
      const match = await getMatch(message.id);
      if (!match) throw new Error("Partida não encontrada.");
      match.sync = {
        uploadedAt: new Date().toISOString(),
        origin: message.origin,
        username: message.username,
        replayId: message.replayId
      };
      match.syncError = null;
      await putMatch(match);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "mark-sync-error") {
      const match = await getMatch(message.id);
      if (!match) throw new Error("Partida não encontrada.");
      match.syncError = { at: new Date().toISOString(), message: message.error };
      await putMatch(match);
      sendResponse({ ok: true });
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

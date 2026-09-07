import {
  compactReplayDocument,
  compactReplayMatch,
  compactReplayPayload,
  compactDecisionChoice,
  firstReplayTurnNo,
  indicators,
  isCompleteMatch,
  isFinished,
  isReplaySyncedToOrigin,
  markReplaySynced,
  markReplaySyncError,
  normalizeCompletion,
  normalizeReplayCapture,
  normalizeReplaySync,
  replayCaptureQuality,
  SYNC_ORIGINS,
} from "./replay-state.js";
import {
  canAppendCaptureFrame,
  captureGameId,
  captureMatchesGame,
  captureMatchesPage,
  createKeyedTaskQueue,
  isValidImportedCandidate,
  matchPagination,
  matchesToPrune,
  normalizeGameId,
  resumableCaptureForPage,
  MAX_BRIDGE_PAYLOAD_BYTES,
  MAX_FRAME_BYTES,
  MAX_IMPORT_BYTES,
  MAX_MATCH_BYTES,
  MAX_STORED_MATCHES,
  MAX_TOTAL_BYTES,
  MATCHES_PER_PAGE,
  utf8Size,
  UUID_PATTERN,
  isTalisharOrigin,
} from "./extension-policy.js";

const DATABASE_NAME = "talishar-local-history";
const DATABASE_VERSION = 1;
const STORE_NAME = "matches";
const SCHEMA_VERSION = "0.6.0";
const CAPTURE_ERROR_KEY = "captureError";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const enqueueCapture = createKeyedTaskQueue();
let creatingOffscreenDocument = null;

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

async function listMatchPage(requestedPage) {
  const total = await withStore("readonly", (store) => store.count());
  const pagination = matchPagination(total, requestedPage);
  if (total === 0) return { ...pagination, matches: [] };

  const database = await openDatabase();
  const matches = await new Promise((resolve, reject) => {
    const results = [];
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index("startedAt").openCursor(null, "prev");
    let advanced = pagination.offset === 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= MATCHES_PER_PAGE) return;
      if (!advanced) {
        advanced = true;
        cursor.advance(pagination.offset);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(results);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });

  return { ...pagination, matches };
}

async function cleanupRetention(protectedId = null, reservedSlots = 0, incomingBytes = 0) {
  const matches = await listMatches();
  const projected = [
    ...matches,
    ...Array.from({ length: reservedSlots }, (_, index) => ({
      id: `__reserved-${index}`,
      status: "recording",
    })),
  ];
  const ids = matchesToPrune(projected, protectedId, incomingBytes);
  await Promise.all(ids.map(deleteMatch));
  const remaining = matches.filter((match) => !ids.includes(match.id));
  const remainingBytes = remaining.reduce(
    (total, match) => total + (Number(match.capturedBytes) || utf8Size(JSON.stringify(match))),
    incomingBytes,
  );
  return {
    deletedIds: ids,
    overCount: remaining.length + reservedSlots > MAX_STORED_MATCHES,
    overBytes: remainingBytes > MAX_TOTAL_BYTES,
  };
}

async function enforceRetention(
  protectedId = null,
  reservedSlots = 0,
  incomingBytes = 0,
  enforceCount = true,
) {
  const result = await cleanupRetention(protectedId, reservedSlots, incomingBytes);
  if ((enforceCount && result.overCount) || result.overBytes) {
    throw new Error("O limite de armazenamento local foi atingido. Exporte ou apague uma gravação antes de continuar.");
  }
  return result;
}

async function setCaptureError(message) {
  await chrome.storage.local.set({
    [CAPTURE_ERROR_KEY]: { at: new Date().toISOString(), message },
  });
}

async function clearCaptureError() {
  await chrome.storage.local.remove(CAPTURE_ERROR_KEY);
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

  const cleaned = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
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
    return {};
  }
}

function parseImportedMatch(raw) {
  if (typeof raw !== "string" || utf8Size(raw) > MAX_IMPORT_BYTES) {
    throw new Error("O replay excede o limite de 50 MB.");
  }

  let parsed;
  try {
    parsed = sanitize(JSON.parse(raw));
  } catch {
    throw new Error("O arquivo não contém JSON válido.");
  }

  const rawCandidate = parsed?.match && typeof parsed.match === "object" && !Array.isArray(parsed.match)
    ? parsed.match
    : parsed;
  if (!isValidImportedCandidate(rawCandidate)) {
    throw new Error("O JSON não parece ser um replay válido do Talishar.");
  }

  const document = compactReplayDocument(parsed);

  const candidate = document.match && typeof document.match === "object" && !Array.isArray(document.match)
    ? document.match
    : document;

  const match = {
    ...candidate,
    schemaVersion: candidate.schemaVersion || document.schemaVersion || SCHEMA_VERSION,
    status: "recording",
    frames: candidate.frames,
    summary: {
      turn: null,
      activePlayer: null,
      winner: null,
      ...(candidate.summary || {})
    },
    sync: candidate.sync,
    syncError: candidate.syncError,
    exportedAt: candidate.exportedAt || document.exportedAt || null
  };
  const normalized = normalizeReplayCapture(normalizeReplaySync(normalizeCompletion(match)));
  normalized.capturedBytes = utf8Size(JSON.stringify(normalized));
  if (normalized.capturedBytes > MAX_MATCH_BYTES) {
    throw new Error("O replay compactado excede o limite local de 40 MB.");
  }
  return normalized;
}

async function importMatch(raw) {
  const match = parseImportedMatch(raw);
  const existing = await getMatch(match.id);
  const existingIsCurrent = existing
    && Array.isArray(existing.frames)
    && existing.frames.length >= match.frames.length
    && (existing.status === "finished" || match.status !== "finished");
  if (existingIsCurrent) {
    await cleanupRetention();
    return { imported: false, id: match.id };
  }
  const existingBytes = Number(existing?.capturedBytes) || (existing ? utf8Size(JSON.stringify(existing)) : 0);
  await enforceRetention(match.id, existing ? 0 : 1, Math.max(0, match.capturedBytes - existingBytes));
  await putMatch(match);
  await cleanupRetention(match.id);
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

function makeMatch(pageSessionId, startedAt, pageUrl, gameId = null) {
  const match = {
    id: pageSessionId,
    schemaVersion: SCHEMA_VERSION,
    capture: {
      source: "Talishar Local History",
      startedAt,
      pageUrl,
      privacy: "Authentication fields, chat and raw requests are discarded; decisions keep only action code, zone and sanitized card or option identifiers.",
      quality: "unknown",
      startedTurn: null,
      interrupted: false
    },
    status: "recording",
    startedAt,
    updatedAt: startedAt,
    endedAt: null,
    result: null,
    frames: [],
    decisionEvents: [],
    summary: {
      turn: null,
      activePlayer: null,
      winner: null
    },
    exportedAt: null,
    sync: { targets: {}, errors: {} },
    capturedBytes: 0
  };
  if (gameId) match.capture.gameId = gameId;
  return match;
}

async function ensureMatch(message) {
  let pageSessionId = typeof message.pageSessionId === "string" && UUID_PATTERN.test(message.pageSessionId)
    ? message.pageSessionId
    : crypto.randomUUID();
  const existing = await getMatch(pageSessionId);
  const gameId = normalizeGameId(message.gameId);
  const existingGameId = captureGameId(existing);
  const matchesIdentity = gameId
    ? (!existingGameId && existing?.frames?.length === 0) || captureMatchesGame(existing, gameId)
    : captureMatchesPage(existing, message.pageUrl);
  if (matchesIdentity) {
    const compacted = compactReplayMatch(existing);
    if (gameId) compacted.capture.gameId = gameId;
    await putMatch(compacted);
    return compacted;
  }
  if (existing) pageSessionId = crypto.randomUUID();
  const resumed = resumableCaptureForPage(await listMatches(), message.pageUrl, gameId);
  if (resumed) {
    const compacted = compactReplayMatch(resumed);
    compacted.capture.interrupted = true;
    normalizeReplayCapture(compacted);
    await putMatch(compacted);
    return compacted;
  }
  await enforceRetention(pageSessionId, 1);
  const match = makeMatch(
    pageSessionId,
    message.startedAt || new Date().toISOString(),
    message.pageUrl || "/",
    gameId,
  );
  await putMatch(match);
  return match;
}

async function recordFrame(message) {
  if (typeof message.pageSessionId !== "string" || !UUID_PATTERN.test(message.pageSessionId)) {
    throw new Error("A sessão de captura é inválida.");
  }
  if (typeof message.payload !== "string" || utf8Size(message.payload) > MAX_BRIDGE_PAYLOAD_BYTES) {
    throw new Error("Uma atualização do Talishar excedeu o limite de captura de 5 MB.");
  }

  const parsedPayload = parseAndSanitize(message.payload);
  const gameId = normalizeGameId(parsedPayload?.initialLoad?.gameGUID);
  const match = await ensureMatch({ ...message, gameId });
  if (!canAppendCaptureFrame(match)) return match;
  const indicator = indicators(parsedPayload);
  const payload = compactReplayPayload(parsedPayload);
  const frame = {
    sequence: match.frames.length + 1,
    receivedAt: message.receivedAt || new Date().toISOString(),
    endpoint: "/GetUpdateSSE.php",
    indicators: indicator,
    payload
  };

  if (match.frames.length === 0) {
    const startedTurn = firstReplayTurnNo({ frames: [frame] });
    match.capture = match.capture || {};
    match.capture.startedTurn = startedTurn;
    match.capture.quality = startedTurn === 0 ? "complete" : startedTurn === null ? "unknown" : "partial";
  }

  const frameBytes = utf8Size(JSON.stringify(frame));
  if (frameBytes > MAX_FRAME_BYTES) {
    throw new Error("Um snapshot compactado excedeu o limite local de 512 KB.");
  }
  const capturedBytes = Number(match.capturedBytes) || utf8Size(JSON.stringify(match));
  if (capturedBytes + frameBytes > MAX_MATCH_BYTES) {
    throw new Error("A partida atingiu o limite local de 40 MB. Exporte ou apague gravações antigas.");
  }
  await enforceRetention(match.id, 0, frameBytes, false);

  match.frames.push(frame);
  match.capturedBytes = capturedBytes + frameBytes;
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
  return match;
}

async function finishMatch(match, completion) {
  if (!match || match.status === "finished") return match;
  if (replayCaptureQuality(match) !== "complete") {
    throw new Error("Somente uma captura iniciada no T0 pode ser finalizada.");
  }
  match.status = "finished";
  match.endedAt = completion.at;
  match.updatedAt = completion.at;
  match.result = completion.result;
  match.completion = completion;
  await putMatch(compactReplayMatch(match));
  return match;
}

async function recordCompletion(message) {
  if (!["concession", "claimed_victory"].includes(message.reason)) {
    throw new Error("O tipo de encerramento é inválido.");
  }
  const result = message.reason === "concession" ? "defeat" : "victory";
  const match = await getMatch(message.pageSessionId);
  if (!match) throw new Error("Replay não encontrado.");
  return finishMatch(match, {
    reason: message.reason,
    source: "talishar-action",
    at: message.occurredAt || new Date().toISOString(),
    result,
  });
}

async function finishMatchManually(message) {
  if (!["victory", "defeat"].includes(message.result)) {
    throw new Error("O resultado informado é inválido.");
  }
  const match = await getMatch(message.id);
  if (!match) throw new Error("Replay não encontrado.");
  return finishMatch(match, {
    reason: "manual",
    source: "extension-popup",
    at: match.updatedAt || new Date().toISOString(),
    result: message.result,
  });
}

async function recordDecision(message) {
  if (typeof message.pageSessionId !== "string" || !UUID_PATTERN.test(message.pageSessionId)) {
    throw new Error("A sessão de captura é inválida.");
  }
  const match = await ensureMatch(message);
  if (!canAppendCaptureFrame(match)) return;
  const choice = compactDecisionChoice(message.choice);
  if (!choice) throw new Error("A decisão capturada é inválida.");
  if (!Array.isArray(match.decisionEvents)) match.decisionEvents = [];
  if (match.decisionEvents.length >= 5_000) {
    throw new Error("A partida atingiu o limite de decisões capturadas.");
  }

  const event = {
    sequence: match.decisionEvents.length + 1,
    frameSequence: match.frames.length,
    occurredAt: Number.isFinite(Date.parse(message.occurredAt))
      ? message.occurredAt
      : new Date().toISOString(),
    choice
  };
  const eventBytes = utf8Size(JSON.stringify(event));
  const capturedBytes = Number(match.capturedBytes) || utf8Size(JSON.stringify(match));
  if (capturedBytes + eventBytes > MAX_MATCH_BYTES) {
    throw new Error("A partida atingiu o limite local de 40 MB. Exporte ou apague gravações antigas.");
  }
  await enforceRetention(match.id, 0, eventBytes, false);
  match.decisionEvents.push(event);
  match.capturedBytes = capturedBytes + eventBytes;
  match.updatedAt = event.occurredAt;
  await putMatch(match);
}

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["BLOBS"],
      justification: "Gerar arquivos JSON grandes sem bloquear o popup da extensão.",
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

async function notifyPopup(status) {
  await chrome.runtime.sendMessage({ ...status, target: "popup" }).catch(() => undefined);
}

async function queueExportMatch(matchId) {
  if (typeof matchId !== "string") throw new Error("Partida não encontrada.");
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "queue-export-match",
    target: "offscreen",
    matchId,
    jobId: crypto.randomUUID(),
  });
  if (!response?.ok) throw new Error(response?.error || "Não foi possível enfileirar o download.");
  const result = response.result;
  await notifyPopup({
    type: "export-match-status",
    status: "preparing",
    matchId,
    jobId: result.jobId,
  });
  return result;
}

async function startExportDownload(message, sender) {
  if (sender.url !== chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)) {
    throw new Error("Origem do download não autorizada.");
  }
  const blobPrefix = `blob:chrome-extension://${chrome.runtime.id}/`;
  if (typeof message.url !== "string" || !message.url.startsWith(blobPrefix)) {
    throw new Error("URL de download inválida.");
  }
  if (
    typeof message.filename !== "string" ||
    !/^talishar-history-[\p{L}\p{N}_.:-]+\.json$/u.test(message.filename)
  ) {
    throw new Error("Nome do arquivo de download inválido.");
  }
  return chrome.downloads.download({
    url: message.url,
    filename: `Talishar Local History/${message.filename}`,
    saveAs: false,
    conflictAction: "uniquify",
  });
}

async function handleExportJobStatus(message) {
  if (!(["started", "error"].includes(message.status))) return;
  if (message.status === "started") {
    const match = await getMatch(message.matchId);
    if (match) {
      match.exportedAt = message.exportedAt || new Date().toISOString();
      await putMatch(match);
      await cleanupRetention();
    }
  }
  await notifyPopup({
    type: "export-match-status",
    status: message.status,
    matchId: message.matchId,
    jobId: message.jobId,
    filename: message.filename,
    error: message.error,
  });
}

function senderOrigin(sender) {
  const url = sender?.url || sender?.tab?.url;
  if (typeof url === "string" && url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
    return `chrome-extension://${chrome.runtime.id}`;
  }
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isTrustedMessage(message, sender) {
  const origin = senderOrigin(sender);
  if (["capture-session-start", "capture-frame", "capture-decision", "capture-completion"].includes(message?.type)) {
    return isTalisharOrigin(origin);
  }
  if (["list-sync-pending", "get-sync-match", "mark-match-synced", "mark-sync-error"].includes(message?.type)) {
    return SYNC_ORIGINS.includes(origin);
  }
  return origin === `chrome-extension://${chrome.runtime.id}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (["offscreen", "popup"].includes(message?.target)) return false;
  (async () => {
    if (!message?.type) return;
    if (!isTrustedMessage(message, sender)) throw new Error("Origem da mensagem não autorizada.");
    if (message.type === "start-export-download" && message.target === "background") {
      const downloadId = await startExportDownload(message, sender);
      sendResponse({ ok: true, downloadId });
      return;
    }
    if (message.type === "export-job-status" && message.target === "background") {
      await handleExportJobStatus(message);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "capture-session-start") {
      await cleanupRetention(message.pageSessionId);
      const match = await ensureMatch(message);
      await clearCaptureError();
      sendResponse({ ok: true, pageSessionId: match.id });
      return;
    }
    if (message.type === "capture-frame") {
      const match = await enqueueCapture(message.pageSessionId, () => recordFrame(message));
      sendResponse({ ok: true, pageSessionId: match?.id || message.pageSessionId });
      return;
    }
    if (message.type === "capture-decision") {
      await enqueueCapture(message.pageSessionId, () => recordDecision(message));
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "capture-completion") {
      await enqueueCapture(message.pageSessionId, () => recordCompletion(message));
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "finish-match-manually") {
      await finishMatchManually(message);
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
      const result = await listMatchPage(message.page);
      const matches = result.matches
        .map((match) => normalizeReplayCapture(normalizeCompletion(compactReplayMatch(match))));
      const captureState = await chrome.storage.local.get(CAPTURE_ERROR_KEY);
      sendResponse({
        ok: true,
        captureError: captureState[CAPTURE_ERROR_KEY] || null,
        page: result.page,
        pageCount: result.pageCount,
        total: result.total,
        matches: matches.map((match) => ({
          id: match.id,
          status: match.status,
          startedAt: match.startedAt,
          updatedAt: match.updatedAt,
          endedAt: match.endedAt,
          frameCount: match.frames.length,
          captureQuality: replayCaptureQuality(match),
          startedTurn: match.capture?.startedTurn ?? null,
          captureInterrupted: match.capture?.interrupted === true,
          gameMode: gameMode(match),
          summary: match.summary,
          exportedAt: match.exportedAt,
          sync: match.sync || null,
          syncError: match.syncError || null,
        })),
      });
      return;
    }
    if (message.type === "list-sync-pending") {
      const origin = senderOrigin(sender);
      const matches = (await listMatches()).map((match) => normalizeReplayCapture(normalizeCompletion(compactReplayMatch(match))));
      await Promise.all(matches.map(putMatch));
      sendResponse({
        ok: true,
        ids: matches.filter((match) => (
          match.status === "finished" &&
          replayCaptureQuality(match) === "complete" &&
          !isReplaySyncedToOrigin(match, origin)
        )).map((match) => match.id)
      });
      return;
    }
    if (message.type === "get-sync-match") {
      const origin = senderOrigin(sender);
      const match = compactReplayMatch(await getMatch(message.id));
      if (
        !match ||
        !isCompleteMatch(match) ||
        replayCaptureQuality(match) !== "complete" ||
        isReplaySyncedToOrigin(match, origin)
      ) {
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
      const origin = senderOrigin(sender);
      const match = compactReplayMatch(await getMatch(message.id));
      if (!match) throw new Error("Partida não encontrada.");
      markReplaySynced(match, origin, {
        username: message.username,
        replayId: message.replayId
      });
      await putMatch(match);
      await cleanupRetention();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "mark-sync-error") {
      const origin = senderOrigin(sender);
      const match = compactReplayMatch(await getMatch(message.id));
      if (!match) throw new Error("Partida não encontrada.");
      markReplaySyncError(match, origin, message.error);
      await putMatch(match);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "export-match") {
      sendResponse({ ok: true, result: await queueExportMatch(message.id) });
      return;
    }
    if (message.type === "delete-match") {
      await deleteMatch(message.id);
      await cleanupRetention();
      sendResponse({ ok: true });
      return;
    }
  })().catch(async (error) => {
    if (["capture-frame", "capture-decision"].includes(message?.type)) {
      await setCaptureError(error.message).catch(() => undefined);
    }
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

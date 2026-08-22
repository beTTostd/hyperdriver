(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const CAPTURE_ERROR_KEY = "captureError";
  const MAX_BRIDGE_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_FRAMES_PER_MINUTE = 240;
  const sessionHelpers = globalThis.__talisharCaptureSession;
  if (!sessionHelpers) return;
  const isGamePage = window.location.pathname === "/game" || window.location.pathname.startsWith("/game/");
  if (!isGamePage) return;
  const LEGACY_SESSION_STORAGE_KEY = "talishar-local-history-session";
  const pageUrl = window.location.pathname;
  const sessionStorageKey = `${LEGACY_SESSION_STORAGE_KEY}:${pageUrl}`;
  let storedSession = null;
  let captureErrorActive = false;
  try {
    storedSession = JSON.parse(
      sessionStorage.getItem(sessionStorageKey) ||
      sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY) ||
      "null",
    );
  } catch {
    // A fresh session is sufficient when sessionStorage is unavailable.
  }
  let pageSessionId = sessionHelpers.pageSessionId(storedSession, pageUrl);

  async function reportCaptureError(error) {
    captureErrorActive = true;
    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({
      [CAPTURE_ERROR_KEY]: { at: new Date().toISOString(), message },
    }).catch(() => undefined);
  }

  const sessionReady = chrome.runtime.sendMessage({
    type: "capture-session-start",
    pageSessionId,
    pageUrl,
    startedAt: new Date().toISOString()
  }).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Não foi possível iniciar a captura.");
    if (response?.pageSessionId) pageSessionId = response.pageSessionId;
    try {
      sessionStorage.setItem(sessionStorageKey, JSON.stringify({ id: pageSessionId, pageUrl }));
    } catch {
      // Capturing can continue without persisting the session id.
    }
    return true;
  }).catch(async (error) => {
    await reportCaptureError(error);
    return false;
  });

  let frameQueue = Promise.resolve();
  const recentFrames = [];

  function acceptsFrame(data) {
    if (data.endpoint !== "/GetUpdateSSE.php" || typeof data.payload !== "string") return false;
    if (new TextEncoder().encode(data.payload).byteLength > MAX_BRIDGE_PAYLOAD_BYTES) {
      reportCaptureError("Uma atualização do Talishar excedeu o limite de captura de 5 MB.");
      return false;
    }
    const now = Date.now();
    while (recentFrames.length && recentFrames[0] <= now - 60_000) recentFrames.shift();
    if (recentFrames.length >= MAX_FRAMES_PER_MINUTE) {
      reportCaptureError("A captura foi pausada porque o Talishar enviou eventos em excesso.");
      return false;
    }
    recentFrames.push(now);
    return true;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.type !== "sse-frame" || !acceptsFrame(data)) return;

    frameQueue = frameQueue
      .catch(() => undefined)
      .then(() => sessionReady)
      .then(async (ready) => {
        if (!ready) throw new Error("A sessão de captura não foi iniciada.");
        const response = await chrome.runtime.sendMessage({
          type: "capture-frame",
          pageSessionId,
          pageUrl,
          endpoint: "/GetUpdateSSE.php",
          payload: data.payload,
          receivedAt: new Date().toISOString()
        });
        if (!response?.ok) throw new Error(response?.error || "Não foi possível salvar um snapshot.");
        if (captureErrorActive) {
          await chrome.storage.local.remove(CAPTURE_ERROR_KEY);
          captureErrorActive = false;
        }
      })
      .catch(reportCaptureError);
  });
})();

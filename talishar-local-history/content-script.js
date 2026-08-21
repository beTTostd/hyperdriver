(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const CAPTURE_ERROR_KEY = "captureError";
  const MAX_BRIDGE_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_FRAMES_PER_MINUTE = 240;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isGamePage = window.location.pathname === "/game" || window.location.pathname.startsWith("/game/");
  if (!isGamePage) return;
  const SESSION_STORAGE_KEY = "talishar-local-history-session";
  const pageUrl = window.location.pathname;
  let pageSessionId = crypto.randomUUID();
  let captureErrorActive = false;
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (stored?.pageUrl === pageUrl && typeof stored.id === "string" && UUID_PATTERN.test(stored.id)) pageSessionId = stored.id;
  } catch {
    // A fresh session is sufficient when sessionStorage is unavailable.
  }

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
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id: pageSessionId, pageUrl }));
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

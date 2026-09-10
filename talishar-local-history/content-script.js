(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const CAPTURE_ERROR_KEY = "captureError";
  const MAX_BRIDGE_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_DECISION_EVENT_BYTES = 4 * 1024;
  const MAX_FRAMES_PER_MINUTE = 240;
  const sessionHelpers = globalThis.__talisharCaptureSession;
  if (!sessionHelpers) return;
  const LEGACY_SESSION_STORAGE_KEY = "talishar-local-history-session";
  let captureErrorActive = false;
  const captureSessions = new Map();

  async function reportCaptureError(error) {
    captureErrorActive = true;
    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({
      [CAPTURE_ERROR_KEY]: { at: new Date().toISOString(), message },
    }).catch(() => undefined);
  }

  function storedSessionFor(pageUrl) {
    const sessionStorageKey = `${LEGACY_SESSION_STORAGE_KEY}:${pageUrl}`;
    try {
      return {
        sessionStorageKey,
        storedSession: JSON.parse(
          sessionStorage.getItem(sessionStorageKey) ||
          sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY) ||
          "null",
        ),
      };
    } catch {
      return { sessionStorageKey, storedSession: null };
    }
  }

  function captureSessionFor(pageUrl) {
    const current = captureSessions.get(pageUrl);
    if (current) return current;

    const { sessionStorageKey, storedSession } = storedSessionFor(pageUrl);
    const session = {
      pageSessionId: sessionHelpers.pageSessionId(storedSession, pageUrl),
      ready: null,
    };
    captureSessions.set(pageUrl, session);
    session.ready = chrome.runtime.sendMessage({
      type: "capture-session-start",
      pageSessionId: session.pageSessionId,
      pageUrl,
      startedAt: new Date().toISOString()
    }).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "Não foi possível iniciar a captura.");
      if (response?.pageSessionId) session.pageSessionId = response.pageSessionId;
      try {
        sessionStorage.setItem(sessionStorageKey, JSON.stringify({ id: session.pageSessionId, pageUrl }));
      } catch {
        // Capturing can continue without persisting the session id.
      }
      return true;
    }).catch(async (error) => {
      captureSessions.delete(pageUrl);
      await reportCaptureError(error);
      return false;
    });
    return session;
  }

  let frameQueue = Promise.resolve();
  const recentFrames = [];
  const recentDecisions = [];

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

  function decisionToken(value, maxLength = 256) {
    if (typeof value !== "string" || !value || value.length > maxLength) return false;
    return /^[\p{L}\p{N}_.:+\-/]+$/u.test(value);
  }

  function acceptsDecision(data) {
    if (!data.choice || typeof data.choice !== "object" || Array.isArray(data.choice)) return false;
    if (!decisionToken(data.choice.action, 40)) return false;
    if (data.choice.zone !== undefined && !decisionToken(data.choice.zone, 40)) return false;
    if (data.choice.identifier !== undefined && !decisionToken(data.choice.identifier)) return false;
    if (data.choice.identifiers !== undefined && (
      !Array.isArray(data.choice.identifiers) ||
      data.choice.identifiers.length > 100 ||
      data.choice.identifiers.some((identifier) => !decisionToken(identifier))
    )) return false;
    if (new TextEncoder().encode(JSON.stringify(data.choice)).byteLength > MAX_DECISION_EVENT_BYTES) return false;
    const now = Date.now();
    while (recentDecisions.length && recentDecisions[0] <= now - 60_000) recentDecisions.shift();
    if (recentDecisions.length >= MAX_FRAMES_PER_MINUTE) return false;
    recentDecisions.push(now);
    return true;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    const captureFrame = data.type === "sse-frame" && acceptsFrame(data);
    const captureDecision = data.type === "decision-event" && acceptsDecision(data);
    const captureCompletion = data.type === "completion-event" &&
      ["concession", "claimed_victory"].includes(data.reason);
    if (!captureFrame && !captureDecision && !captureCompletion) return;
    const pageUrl = sessionHelpers.gamePageUrl(window.location.pathname);
    if (!pageUrl) return;
    const captureSession = captureSessionFor(pageUrl);

    frameQueue = frameQueue
      .catch(() => undefined)
      .then(() => captureSession.ready)
      .then(async (ready) => {
        if (!ready) throw new Error("A sessão de captura não foi iniciada.");
        const response = await chrome.runtime.sendMessage(
          captureFrame ? {
            type: "capture-frame",
            pageSessionId: captureSession.pageSessionId,
            pageUrl,
            endpoint: "/GetUpdateSSE.php",
            payload: data.payload,
            receivedAt: data.receivedAt || new Date().toISOString()
          } : captureDecision ? {
            type: "capture-decision",
            pageSessionId: captureSession.pageSessionId,
            pageUrl,
            choice: data.choice,
            occurredAt: data.occurredAt || new Date().toISOString()
          } : {
            type: "capture-completion",
            pageSessionId: captureSession.pageSessionId,
            pageUrl,
            reason: data.reason,
            occurredAt: data.occurredAt || new Date().toISOString()
          },
        );
        if (!response?.ok) throw new Error(response?.error || "Não foi possível salvar um snapshot.");
        if (response.pageSessionId && response.pageSessionId !== captureSession.pageSessionId) {
          captureSession.pageSessionId = response.pageSessionId;
          try {
            sessionStorage.setItem(
              `${LEGACY_SESSION_STORAGE_KEY}:${pageUrl}`,
              JSON.stringify({ id: captureSession.pageSessionId, pageUrl }),
            );
          } catch {
            // Capturing can continue without persisting the rotated session id.
          }
        }
        if (captureErrorActive) {
          await chrome.storage.local.remove(CAPTURE_ERROR_KEY);
          captureErrorActive = false;
        }
      })
      .catch(reportCaptureError);
  });
})();

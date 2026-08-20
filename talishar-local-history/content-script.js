(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const isGamePage = window.location.pathname === "/game" || window.location.pathname.startsWith("/game/");
  if (!isGamePage) return;
  const SESSION_STORAGE_KEY = "talishar-local-history-session";
  const pageUrl = window.location.pathname;
  let pageSessionId = crypto.randomUUID();
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (stored?.pageUrl === pageUrl && typeof stored.id === "string") pageSessionId = stored.id;
  } catch {
    // A fresh session is sufficient when sessionStorage is unavailable.
  }

  const sessionReady = chrome.runtime.sendMessage({
    type: "capture-session-start",
    pageSessionId,
    pageUrl,
    startedAt: new Date().toISOString()
  }).then((response) => {
    if (response?.pageSessionId) pageSessionId = response.pageSessionId;
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id: pageSessionId, pageUrl }));
    } catch {
      // Capturing can continue without persisting the session id.
    }
  }).catch(() => undefined);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.type !== "sse-frame") return;
    if (typeof data.payload !== "string") return;

    sessionReady.finally(() => {
      chrome.runtime.sendMessage({
        type: "capture-frame",
        pageSessionId,
        endpoint: data.endpoint,
        payload: data.payload,
        receivedAt: data.receivedAt
      }).catch(() => undefined);
    });
  });
})();

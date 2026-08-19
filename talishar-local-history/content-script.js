(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const isGamePage = window.location.pathname === "/game" || window.location.pathname.startsWith("/game/");
  if (!isGamePage) return;
  const pageSessionId = crypto.randomUUID();

  chrome.runtime.sendMessage({
    type: "capture-session-start",
    pageSessionId,
    pageUrl: window.location.pathname,
    startedAt: new Date().toISOString()
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.type !== "sse-frame") return;
    if (typeof data.payload !== "string") return;

    chrome.runtime.sendMessage({
      type: "capture-frame",
      pageSessionId,
      endpoint: data.endpoint,
      payload: data.payload,
      receivedAt: data.receivedAt
    });
  });
})();

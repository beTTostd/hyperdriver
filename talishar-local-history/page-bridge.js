(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const NativeEventSource = window.EventSource;

  if (!NativeEventSource || window.__talisharLocalHistoryBridgeInstalled) return;
  window.__talisharLocalHistoryBridgeInstalled = true;

  const isTalisharGameStream = (url) => {
    try {
      const parsed = new URL(String(url), window.location.href);
      return (
        ["talishar.net", "api.talishar.net"].includes(parsed.hostname) &&
        parsed.pathname.endsWith("/GetUpdateSSE.php")
      );
    } catch {
      return false;
    }
  };

  function LocalHistoryEventSource(url, configuration) {
    const source = new NativeEventSource(url, configuration);

    if (isTalisharGameStream(url)) {
      source.addEventListener("message", (event) => {
        window.postMessage(
          {
            channel: CHANNEL,
            type: "sse-frame",
            endpoint: "/GetUpdateSSE.php",
            payload: event.data,
            receivedAt: new Date().toISOString()
          },
          window.location.origin
        );
      });
    }

    return source;
  }

  LocalHistoryEventSource.prototype = NativeEventSource.prototype;
  Object.setPrototypeOf(LocalHistoryEventSource, NativeEventSource);
  window.EventSource = LocalHistoryEventSource;
})();

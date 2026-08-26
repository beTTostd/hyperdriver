(() => {
  "use strict";

  const CHANNEL = "__talishar_local_history__";
  const NativeEventSource = window.EventSource;
  const NativeFetch = window.fetch?.bind(window);
  const NativeXMLHttpRequest = window.XMLHttpRequest;
  const decisionCapture = globalThis.__hyperdriverDecisionCapture;

  if ((!NativeEventSource && !NativeFetch && !NativeXMLHttpRequest) || window.__talisharLocalHistoryBridgeInstalled) return;
  window.__talisharLocalHistoryBridgeInstalled = true;

  const postDecision = (choice) => {
    if (!choice) return;
    window.postMessage(
      {
        channel: CHANNEL,
        type: "decision-event",
        choice,
        occurredAt: new Date().toISOString()
      },
      window.location.origin
    );
  };

  const acceptedResponseBody = (body) => typeof body !== "string" || !body.trim().startsWith("Invalid");

  const isTalisharGameStream = (url) => {
    try {
      const parsed = new URL(String(url), window.location.href);
      return (
        parsed.protocol === "https:" &&
        (parsed.hostname === "talishar.net" || parsed.hostname.endsWith(".talishar.net")) &&
        parsed.pathname.endsWith("/GetUpdateSSE.php")
      );
    } catch {
      return false;
    }
  };

  if (NativeEventSource) {
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
  }

  if (NativeFetch && decisionCapture) {
    window.fetch = async function hyperdriverDecisionAwareFetch(input, init) {
      const decisionPromise = decisionCapture
        .decisionFromRequest(input, init, window.location.href)
        .catch(() => null);
      const response = await NativeFetch(input, init);
      const choice = await decisionPromise;
      if (!choice || !response.ok) return response;

      let accepted = true;
      try {
        const body = (await response.clone().text()).trim();
        accepted = !body.startsWith("Invalid");
      } catch {
        // An unreadable clone does not alter the original response.
      }
      if (accepted) {
        postDecision(choice);
      }
      return response;
    };
  }

  if (NativeXMLHttpRequest && decisionCapture) {
    const requestMetadata = new WeakMap();
    const nativeOpen = NativeXMLHttpRequest.prototype.open;
    const nativeSend = NativeXMLHttpRequest.prototype.send;

    NativeXMLHttpRequest.prototype.open = function hyperdriverDecisionAwareOpen(method, url, ...rest) {
      requestMetadata.set(this, { url });
      return nativeOpen.call(this, method, url, ...rest);
    };

    NativeXMLHttpRequest.prototype.send = function hyperdriverDecisionAwareSend(body) {
      const metadata = requestMetadata.get(this);
      if (!metadata || !decisionCapture.actionUrl(metadata.url, window.location.href)) {
        return nativeSend.call(this, body);
      }
      const decisionPromise = decisionCapture
        .decisionFromRequest(metadata.url, { body }, window.location.href)
        .catch(() => null);

      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        let responseBody;
        try {
          if (!this.responseType || this.responseType === "text") responseBody = this.responseText;
        } catch {
          responseBody = undefined;
        }
        if (!acceptedResponseBody(responseBody)) return;
        decisionPromise.then(postDecision).catch(() => undefined);
      }, { once: true });

      return nativeSend.call(this, body);
    };
  }
})();

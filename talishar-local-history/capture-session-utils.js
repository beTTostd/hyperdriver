(() => {
  "use strict";

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function gamePageUrl(pathname) {
    return pathname === "/game" || pathname?.startsWith("/game/") ? pathname : null;
  }

  function pageSessionId(stored, pageUrl, createId = () => crypto.randomUUID()) {
    if (stored?.pageUrl === pageUrl && typeof stored.id === "string" && UUID_PATTERN.test(stored.id)) {
      return stored.id;
    }
    return createId();
  }

  globalThis.__talisharCaptureSession = Object.freeze({ gamePageUrl, pageSessionId });
})();

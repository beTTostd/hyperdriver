(() => {
  "use strict";

  const allowedOrigins = new Set([
    "https://hyperdriver.com.br",
    "https://beta.hyperdriver.com.br"
  ]);
  if (!allowedOrigins.has(window.location.origin)) return;

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Falha ao acessar os replays locais.");
    return response;
  }

  async function synchronize() {
    const pending = await send({ type: "list-sync-pending" });
    let uploaded = 0;

    for (const id of pending.ids) {
      const local = await send({ type: "get-sync-match", id });
      if (!local.document) continue;

      let response;
      try {
        response = await fetch("/api/replays", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(local.document)
        });
      } catch {
        await send({ type: "mark-sync-error", id, error: "Hyperdriver indisponível." });
        break;
      }

      const result = await response.json().catch(() => ({}));
      if (response.status === 401) break;
      if (!response.ok) {
        await send({
          type: "mark-sync-error",
          id,
          error: result.error || "O servidor recusou o replay."
        });
        continue;
      }

      await send({
        type: "mark-match-synced",
        id,
        origin: window.location.origin,
        username: result.username,
        replayId: result.replayId
      });
      uploaded += 1;
    }

    if (uploaded > 0) window.location.reload();
  }

  synchronize().catch(() => undefined);
})();

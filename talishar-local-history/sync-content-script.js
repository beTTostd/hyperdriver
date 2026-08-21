(() => {
  "use strict";

  const allowedOrigins = new Set([
    "https://hyperdriver.com.br",
    "https://beta.hyperdriver.com.br"
  ]);
  if (!allowedOrigins.has(window.location.origin)) return;

  const syncHelpers = globalThis.__hyperdriverSync;
  if (!syncHelpers) return;

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Falha ao acessar os replays locais.");
    return response;
  }

  function createToast(total) {
    const existing = document.querySelector("#hyperdriver-sync-toast");
    existing?.remove();

    const toast = document.createElement("aside");
    toast.id = "hyperdriver-sync-toast";
    toast.dataset.state = "syncing";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-atomic", "true");

    const eyebrow = document.createElement("span");
    eyebrow.className = "hyperdriver-sync-toast__eyebrow";
    eyebrow.textContent = "Local history / sync";

    const title = document.createElement("strong");
    title.className = "hyperdriver-sync-toast__title";
    title.textContent = "Sincronizando replays";

    const message = document.createElement("span");
    message.className = "hyperdriver-sync-toast__message";

    const progressLabel = document.createElement("span");
    progressLabel.className = "hyperdriver-sync-toast__progress-label";
    progressLabel.textContent = "Progresso 0%";

    const track = document.createElement("span");
    track.className = "hyperdriver-sync-toast__track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Progresso da sincronização");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", "0");

    const fill = document.createElement("span");
    fill.className = "hyperdriver-sync-toast__fill";
    track.append(fill);
    toast.append(eyebrow, title, message, progressLabel, track);
    document.body.append(toast);

    function renderProgress({ current, percentage, phase, error }) {
      const value = Math.max(0, Math.min(100, percentage));
      toast.dataset.state = phase === "error" ? "error" : "syncing";
      message.textContent = error
        ? `Partida ${current} de ${total}: ${error}`
        : `Enviando partida ${current} de ${total}`;
      progressLabel.textContent = `Progresso ${value}%`;
      fill.style.width = `${value}%`;
      track.setAttribute("aria-valuenow", String(value));
    }

    function finish(result) {
      const hasErrors = result.errors.length > 0 || result.interrupted;
      toast.dataset.state = hasErrors ? "error" : "complete";
      title.textContent = hasErrors ? "Sincronização parcial" : "Sincronização concluída";
      if (result.interrupted) {
        message.textContent = "Entre novamente no Hyperdriver para continuar.";
      } else if (hasErrors) {
        const uploadedLabel = `${result.uploaded} partida${result.uploaded === 1 ? "" : "s"} enviada${result.uploaded === 1 ? "" : "s"}`;
        const firstError = result.errors[0]?.message;
        message.textContent = `${uploadedLabel}; ${result.errors.length} com erro.${firstError ? ` ${firstError}` : ""}`;
      } else {
        message.textContent = `${result.uploaded} partida${result.uploaded === 1 ? "" : "s"} enviada${result.uploaded === 1 ? "" : "s"}.`;
      }
      const percentage = syncHelpers.progressPercentage(result.processed, result.total);
      progressLabel.textContent = `Progresso ${percentage}%`;
      fill.style.width = `${percentage}%`;
      track.setAttribute("aria-valuenow", String(percentage));
      window.setTimeout(() => toast.remove(), hasErrors ? 6500 : 3500);
    }

    function fail(error) {
      toast.dataset.state = "error";
      title.textContent = "Sincronização interrompida";
      message.textContent = error instanceof Error ? error.message : String(error);
      window.setTimeout(() => toast.remove(), 6500);
    }

    return { fail, finish, renderProgress };
  }

  async function runSynchronization() {
    const pending = await send({ type: "list-sync-pending" });
    const ids = Array.isArray(pending.ids) ? pending.ids : [];
    if (!ids.length) return 0;

    const toast = createToast(ids.length);
    let result;
    try {
      result = await syncHelpers.synchronizePendingReplays({
        ids,
        getReplay: (id) => send({ type: "get-sync-match", id }),
        upload: (document) => fetch("/api/replays", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(document)
        }),
        markError: (id, error) => send({ type: "mark-sync-error", id, error }),
        markSynced: (id, response) => send({
          type: "mark-match-synced",
          id,
          origin: window.location.origin,
          username: response.username,
          replayId: response.replayId
        }),
        onProgress: toast.renderProgress,
      });
      toast.finish(result);
    } catch (error) {
      toast.fail(error);
      throw error;
    }

    if (syncHelpers.shouldReload(window.location.pathname, result.uploaded, result.interrupted)) {
      window.location.reload();
    }
    return result.uploaded;
  }

  let synchronizationPromise = null;
  function synchronize() {
    if (!synchronizationPromise) {
      synchronizationPromise = runSynchronization().finally(() => {
        synchronizationPromise = null;
      });
    }
    return synchronizationPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "sync-now") return;
    synchronize()
      .then((uploaded) => sendResponse({ ok: true, uploaded }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  synchronize().catch(() => undefined);
})();

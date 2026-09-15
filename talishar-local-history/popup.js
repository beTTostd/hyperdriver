import { replaySyncProgress, replaySyncState, SYNC_ORIGINS } from "./replay-state.js";

const statusElement = document.querySelector("#status");
const matchesElement = document.querySelector("#matches");
const importButton = document.querySelector("#import-button");
const importFiles = document.querySelector("#import-files");
const syncButton = document.querySelector("#sync-button");
const paginationElement = document.querySelector("#pagination");
const previousPageButton = document.querySelector("#previous-page");
const nextPageButton = document.querySelector("#next-page");
const pageIndicator = document.querySelector("#page-indicator");
const environmentSelect = document.querySelector("#environment");
const connectionState = document.querySelector("#connection-state");
const connectionDetail = document.querySelector("#connection-detail");
const openEnvironmentButton = document.querySelector("#open-environment");
const downloadStates = new Map();
let currentPage = 1;
let pageCount = 1;

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function setStatus(message, error = false) {
  statusElement.textContent = message;
  statusElement.className = error ? "error" : "";
}

async function refreshConnection() {
  try {
    const response = await send({ type: "sync-status", origin: environmentSelect.value });
    const value = response.result;
    environmentSelect.value = value.origin;
    connectionState.textContent = value.connected ? "Hyperdriver conectado" : "Hyperdriver não aberto";
    const lastSync = value.lastSync?.at
      ? ` Última tentativa: ${formatDate(value.lastSync.at)}${value.lastSync.ok ? " com sucesso" : " com erro"}.`
      : " Nenhuma sincronização registrada neste ambiente.";
    connectionDetail.textContent = `${value.pending} ${value.pending === 1 ? "captura pendente" : "capturas pendentes"}.${lastSync}`;
    syncButton.textContent = value.pending ? `Sincronizar ${value.pending} pendente${value.pending === 1 ? "" : "s"}` : "Tudo sincronizado";
  } catch (error) {
    connectionState.textContent = "Estado indisponível";
    connectionDetail.textContent = error.message;
  }
}

function gameModeLabel(value) {
  const labels = {
    blitz: "Blitz",
    cc: "Classic Constructed",
    commoner: "Commoner",
    draft: "Booster Draft",
    ll: "Living Legend",
    sealed: "Sealed Deck",
    upf: "Ultimate Pit Fight"
  };
  return labels[value?.toLowerCase()] || value?.toUpperCase() || "Talishar";
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Não foi possível concluir a ação.");
  return response;
}

function render(matches, total) {
  matchesElement.replaceChildren();
  if (!matches.length) {
    matchesElement.textContent = "Abra uma partida no Talishar para iniciar a captura.";
  }

  for (const match of matches) {
    const item = document.createElement("article");
    item.className = "match";
    item.dataset.matchId = match.id;
    const title = document.createElement("strong");
    title.textContent = gameModeLabel(match.gameMode);
    const metadata = document.createElement("span");
    metadata.textContent = `${formatDate(match.startedAt)} · ${match.frameCount} snapshots`;
    const syncState = document.createElement("span");
    syncState.className = "sync-state";
    const progress = replaySyncProgress(match);
    const perOriginSync = replaySyncState(match);
    const synchronizedTargets = SYNC_ORIGINS
      .filter((origin) => perOriginSync.targets[origin]?.uploadedAt)
      .map((origin) => new URL(origin).hostname);
    const errors = SYNC_ORIGINS
      .map((origin) => perOriginSync.errors[origin])
      .filter((error) => error?.message);
    if (match.captureQuality === "partial") {
      syncState.classList.add("error");
      syncState.textContent = "Captura parcial";
      const start = match.startedTurn === null ? "sem T0 verificável" : `iniciada no T${match.startedTurn}`;
      const interruption = match.captureInterrupted ? " e interrompida durante a partida" : "";
      syncState.title = `Captura ${start}${interruption}. Ela pode ser baixada, mas não será sincronizada nem analisada.`;
    } else if (match.captureQuality !== "complete" && match.status !== "recording") {
      syncState.classList.add("error");
      syncState.textContent = "Início não verificado";
      syncState.title = "O início no T0 não pôde ser comprovado. A partida não será sincronizada nem analisada.";
    } else if (match.status === "recording") {
      syncState.classList.add("recording");
      syncState.textContent = "Gravando";
    } else if (progress.synced === 0 && errors.length) {
      syncState.classList.add("error");
      syncState.textContent = "Erro";
      syncState.title = errors.map((error) => error.message).join(" ");
    } else if (progress.synced === 0 && match.exportedAt) {
      syncState.textContent = "Baixado";
      syncState.title = "JSON salvo em Downloads/Talishar Local History.";
    } else if (progress.synced === 0) {
      syncState.classList.add("ready");
      syncState.textContent = "Pronto";
      syncState.title = "Abra cada ambiente do Hyperdriver autenticado para sincronizar.";
    } else {
      syncState.textContent = `Sincronizado ${progress.synced}/${progress.total}`;
      const details = [];
      if (synchronizedTargets.length) details.push(`Enviado para ${synchronizedTargets.join(" e ")}.`);
      if (match.exportedAt) details.push("JSON salvo em Downloads/Talishar Local History.");
      if (errors.length) {
        syncState.classList.add("error");
        details.push(errors.map((error) => error.message).join(" "));
      } else if (progress.synced < progress.total) {
        syncState.classList.add("ready");
        details.push("Abra cada ambiente do Hyperdriver autenticado para sincronizar.");
      }
      syncState.title = details.join(" ");
    }
    const actions = document.createElement("div");
    const captureExplanation = document.createElement("span");
    captureExplanation.className = "capture-explanation";
    if (match.captureQuality === "partial") {
      captureExplanation.textContent = "A captura começou depois do T0 ou foi interrompida. Ela não pode ser analisada, mas o JSON pode ser baixado para recuperação manual.";
    } else if (match.captureQuality !== "complete" && match.status !== "recording") {
      captureExplanation.textContent = "O início da partida não foi confirmado. Baixe o JSON para preservar o que foi capturado; esta cópia não será sincronizada.";
    }
    const downloadMessage = document.createElement("span");
    downloadMessage.className = "download-message";
    const downloadState = downloadStates.get(match.id);
    if (downloadState?.status === "preparing") {
      downloadMessage.textContent = "Preparando download…";
    } else if (downloadState?.status === "error") {
      downloadMessage.classList.add("error");
      downloadMessage.textContent = `Falha no download: ${downloadState.message}`;
    }
    if (match.status === "recording" && match.captureQuality === "complete") {
      for (const [result, label] of [["victory", "Finalizar: vitória"], ["defeat", "Finalizar: derrota"]]) {
        const finishButton = document.createElement("button");
        finishButton.className = "secondary";
        finishButton.textContent = label;
        finishButton.addEventListener("click", async () => {
          const translated = result === "victory" ? "vitória" : "derrota";
          if (!confirm(`Confirma que esta partida terminou em ${translated}? Use somente quando o Talishar já encerrou a partida.`)) return;
          finishButton.disabled = true;
          try {
            await send({ type: "finish-match-manually", id: match.id, result });
            setStatus(`Partida finalizada como ${translated}; abra o Hyperdriver autenticado para sincronizar.`);
            await load();
          } catch (error) {
            setStatus(error.message, true);
          } finally {
            finishButton.disabled = false;
          }
        });
        actions.append(finishButton);
      }
    }
    const exportButton = document.createElement("button");
    exportButton.dataset.action = "export";
    exportButton.disabled = downloadState?.status === "preparing";
    exportButton.textContent = downloadState?.status === "preparing" ? "Preparando…" : "Baixar JSON";
    exportButton.addEventListener("click", async () => {
      updateDownloadState(match.id, { status: "preparing" });
      try {
        const response = await send({ type: "export-match", id: match.id });
        updateDownloadState(match.id, { status: "preparing", jobId: response.result?.jobId });
      } catch (error) {
        updateDownloadState(match.id, { status: "error", message: error.message });
      }
    });
    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary";
    deleteButton.textContent = "Apagar";
    deleteButton.addEventListener("click", async () => {
      if (!confirm("Apagar este histórico local? O arquivo já baixado não será removido.")) return;
      deleteButton.disabled = true;
      try {
        await send({ type: "delete-match", id: match.id });
        await load();
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        deleteButton.disabled = false;
      }
    });
    actions.append(exportButton);
    const secondaryMenu = document.createElement("details");
    const secondarySummary = document.createElement("summary");
    secondarySummary.textContent = "Mais ações";
    const secondaryActions = document.createElement("div");
    secondaryActions.append(deleteButton);
    secondaryMenu.append(secondarySummary, secondaryActions);
    item.append(title, metadata, syncState);
    if (captureExplanation.textContent) item.append(captureExplanation);
    if (downloadMessage.textContent) item.append(downloadMessage);
    item.append(actions, secondaryMenu);
    matchesElement.append(item);
  }

  paginationElement.hidden = total === 0;
  pageIndicator.textContent = `Página ${currentPage} de ${pageCount}`;
  previousPageButton.disabled = currentPage <= 1;
  nextPageButton.disabled = currentPage >= pageCount;
}

function updateDownloadState(matchId, state) {
  downloadStates.set(matchId, state);
  const item = [...matchesElement.querySelectorAll(".match")]
    .find((candidate) => candidate.dataset.matchId === matchId);
  if (!item) return;
  const button = item.querySelector('[data-action="export"]');
  let message = item.querySelector(".download-message");
  if (!message) {
    message = document.createElement("span");
    message.className = "download-message";
    item.insertBefore(message, item.lastElementChild);
  }
  message.classList.toggle("error", state.status === "error");
  message.textContent = state.status === "preparing"
    ? "Preparando download…"
    : state.status === "error"
      ? `Falha no download: ${state.message}`
      : "";
  button.disabled = state.status === "preparing";
  button.textContent = state.status === "preparing" ? "Preparando…" : "Baixar JSON";
}

async function load(preserveStatus = false) {
  try {
    const response = await send({ type: "list-matches", page: currentPage });
    currentPage = response.page;
    pageCount = response.pageCount;
    render(response.matches, response.total);
    if (response.captureError) setStatus(response.captureError.message, true);
    else if (!preserveStatus) setStatus("");
    await refreshConnection();
  } catch (error) {
    setStatus(error.message, true);
  }
}

previousPageButton.addEventListener("click", async () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  await load(true);
});

nextPageButton.addEventListener("click", async () => {
  if (currentPage >= pageCount) return;
  currentPage += 1;
  await load(true);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "popup" || message.type !== "export-match-status") return;
  if (message.status === "preparing") {
    updateDownloadState(message.matchId, { status: "preparing", jobId: message.jobId });
    return;
  }
  if (message.status === "error") {
    updateDownloadState(message.matchId, { status: "error", message: message.error || "Erro desconhecido." });
    setStatus(`Falha ao baixar o JSON: ${message.error || "Erro desconhecido."}`, true);
    return;
  }
  if (message.status === "started") {
    downloadStates.delete(message.matchId);
    setStatus("Download iniciado em Downloads/Talishar Local History.");
    void load(true);
  }
});

importButton.addEventListener("click", () => importFiles.click());
importFiles.addEventListener("change", async () => {
  const files = [...importFiles.files];
  if (!files.length) return;

  importButton.disabled = true;
  setStatus(`Importando ${files.length} arquivo${files.length === 1 ? "" : "s"}…`);
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const file of files) {
    try {
      const response = await send({ type: "import-match", raw: await file.text() });
      if (response.result?.imported) imported += 1;
      else skipped += 1;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  importFiles.value = "";
  importButton.disabled = false;
  await load();
  let syncRequested = 0;
  try {
    const response = await send({ type: "request-sync", origin: environmentSelect.value });
    syncRequested = response.result?.requested || 0;
  } catch (error) {
    errors.push(`Sincronização: ${error.message}`);
  }
  const summary = `${imported} importado${imported === 1 ? "" : "s"}, ${skipped} já existente${skipped === 1 ? "" : "s"}.`;
  const syncSummary = syncRequested ? " Sincronização solicitada." : " O Hyperdriver foi aberto; confirme o login para sincronizar.";
  setStatus(errors.length ? `${summary}${syncSummary} ${errors.join(" ")}` : `${summary}${syncSummary}`, errors.length > 0);
});

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  setStatus("Solicitando sincronização de todos os replays pendentes…");
  try {
    const response = await send({ type: "request-sync", origin: environmentSelect.value });
    setStatus(response.result?.requested ? "Sincronização solicitada no ambiente selecionado." : "O ambiente selecionado foi aberto. Entre na sua conta para concluir a sincronização.");
    await refreshConnection();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    syncButton.disabled = false;
  }
});

environmentSelect.addEventListener("change", refreshConnection);
openEnvironmentButton.addEventListener("click", async () => {
  openEnvironmentButton.disabled = true;
  try {
    await send({ type: "open-environment", origin: environmentSelect.value });
    setStatus("Ambiente aberto em uma nova aba.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    openEnvironmentButton.disabled = false;
  }
});

load();

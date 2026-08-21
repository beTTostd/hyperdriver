const statusElement = document.querySelector("#status");
const matchesElement = document.querySelector("#matches");
const importButton = document.querySelector("#import-button");
const importFiles = document.querySelector("#import-files");
const syncButton = document.querySelector("#sync-button");

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function setStatus(message, error = false) {
  statusElement.textContent = message;
  statusElement.className = error ? "error" : "";
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

function render(matches) {
  matchesElement.replaceChildren();
  if (!matches.length) {
    matchesElement.textContent = "Abra uma partida no Talishar para iniciar a captura.";
    return;
  }

  for (const match of matches) {
    const item = document.createElement("article");
    item.className = "match";
    const title = document.createElement("strong");
    title.textContent = gameModeLabel(match.gameMode);
    const metadata = document.createElement("span");
    metadata.textContent = `${formatDate(match.startedAt)} · ${match.frameCount} snapshots`;
    const syncState = document.createElement("span");
    syncState.className = "sync-state";
    if (match.sync?.uploadedAt) {
      syncState.textContent = "Sincronizado";
      syncState.title = `Enviado para ${match.sync.username || "sua conta"}`;
    } else if (match.exportedAt) {
      syncState.textContent = "Baixado";
      syncState.title = "JSON salvo em Downloads/Talishar Local History.";
    } else if (match.status === "recording") {
      syncState.classList.add("recording");
      syncState.textContent = "Gravando";
    } else if (match.syncError?.message) {
      syncState.classList.add("error");
      syncState.textContent = "Erro";
      syncState.title = match.syncError.message;
    } else {
      syncState.classList.add("ready");
      syncState.textContent = "Pronto";
      syncState.title = "Abra o Hyperdriver autenticado para sincronizar.";
    }
    const actions = document.createElement("div");
    const exportButton = document.createElement("button");
    exportButton.textContent = "Baixar JSON";
    exportButton.addEventListener("click", async () => {
      exportButton.disabled = true;
      try {
        await send({ type: "export-match", id: match.id });
        setStatus("JSON baixado em Downloads/Talishar Local History.");
        await load();
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        exportButton.disabled = false;
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
    actions.append(exportButton, deleteButton);
    item.append(title, metadata, syncState, actions);
    matchesElement.append(item);
  }
}

async function load() {
  try {
    const response = await send({ type: "list-matches" });
    render(response.matches);
    setStatus(
      response.captureError?.message || "",
      Boolean(response.captureError),
    );
  } catch (error) {
    setStatus(error.message, true);
  }
}

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
    const response = await send({ type: "request-sync" });
    syncRequested = response.result?.requested || 0;
  } catch (error) {
    errors.push(`Sincronização: ${error.message}`);
  }
  const summary = `${imported} importado${imported === 1 ? "" : "s"}, ${skipped} já existente${skipped === 1 ? "" : "s"}.`;
  const syncSummary = syncRequested ? " Sincronização solicitada." : " Abra o Hyperdriver autenticado para sincronizar.";
  setStatus(errors.length ? `${summary}${syncSummary} ${errors.join(" ")}` : `${summary}${syncSummary}`, errors.length > 0);
});

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  setStatus("Solicitando sincronização de todos os replays pendentes…");
  try {
    const response = await send({ type: "request-sync" });
    setStatus(response.result?.requested ? "Sincronização de todos os replays pendentes solicitada." : "Abra o Hyperdriver autenticado para iniciar a sincronização.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    syncButton.disabled = false;
  }
});

load();

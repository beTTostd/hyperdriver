const statusElement = document.querySelector("#status");
const matchesElement = document.querySelector("#matches");

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function setStatus(message, error = false) {
  statusElement.textContent = message;
  statusElement.className = error ? "error" : "";
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
    title.textContent = `Partida ${match.summary.turn ? `T${match.summary.turn}` : "Talishar"}`;
    const metadata = document.createElement("span");
    metadata.textContent = `${formatDate(match.startedAt)} · ${match.frameCount} snapshots`;
    const syncState = document.createElement("span");
    syncState.className = "sync-state";
    if (match.sync?.uploadedAt) {
      syncState.textContent = "Sincronizado";
      syncState.title = `Enviado para ${match.sync.username || "sua conta"}`;
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
      try {
        await send({ type: "export-match", id: match.id });
        setStatus("JSON baixado em Downloads/Talishar Local History.");
        await load();
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary";
    deleteButton.textContent = "Apagar";
    deleteButton.addEventListener("click", async () => {
      if (!confirm("Apagar este histórico local? O arquivo já baixado não será removido.")) return;
      await send({ type: "delete-match", id: match.id });
      await load();
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
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  }
}

load();

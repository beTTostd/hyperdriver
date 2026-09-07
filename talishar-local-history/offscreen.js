import { createDownloadManager } from "./extension-download.js";
import { compactReplayMatch } from "./replay-state.js";

const DATABASE_NAME = "talishar-local-history";
const DATABASE_VERSION = 1;
const STORE_NAME = "matches";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("startedAt", "startedAt");
      store.createIndex("status", "status");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadMatch(id) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

const downloads = createDownloadManager({
  loadMatch,
  compactMatch: compactReplayMatch,
  startDownload: async (url, filename) => {
    const response = await chrome.runtime.sendMessage({
      type: "start-export-download",
      target: "background",
      url,
      filename,
    });
    if (!response?.ok) throw new Error(response?.error || "O Chrome recusou o download.");
    return response.downloadId;
  },
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  notify: (status) => chrome.runtime.sendMessage({ ...status, target: "background" }),
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "queue-export-match") return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Origem da mensagem não autorizada." });
    return false;
  }
  if (typeof message.matchId !== "string" || typeof message.jobId !== "string") {
    sendResponse({ ok: false, error: "Trabalho de download inválido." });
    return false;
  }

  sendResponse({ ok: true, result: downloads.enqueue(message.matchId, message.jobId) });
  return false;
});

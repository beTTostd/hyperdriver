(() => {
  "use strict";

  function progressPercentage(completed, total) {
    const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
    if (!safeTotal) return 0;
    const safeCompleted = Math.min(
      safeTotal,
      Math.max(0, Number.isFinite(completed) ? completed : 0),
    );
    return Math.round((safeCompleted / safeTotal) * 100);
  }

  function isReplayLibraryPathname(pathname) {
    return pathname === "/replays";
  }

  function serializeReplayDocument(document) {
    const body = JSON.stringify(document);
    if (typeof body !== "string") throw new Error("O replay local não pôde ser serializado.");
    JSON.parse(body);
    return body;
  }

  function shouldReload(pathname, uploaded, interrupted = false, completed = false, hasErrors = false) {
    return (uploaded > 0 || completed) && !interrupted && !hasErrors && isReplayLibraryPathname(pathname);
  }

  async function readResponseBody(response) {
    return response.json().catch(() => ({}));
  }

  async function synchronizePendingReplays({
    ids,
    getReplay,
    upload,
    markSynced,
    markError,
    onProgress,
  }) {
    const replayIds = Array.isArray(ids) ? ids : [];
    const total = replayIds.length;
    const errors = [];
    let uploaded = 0;
    let processed = 0;
    let interrupted = false;

    const updateProgress = (index, phase, error = null) => {
      onProgress?.({
        index,
        current: index + 1,
        total,
        completed: phase === "sending" ? index : index + 1,
        percentage: progressPercentage(phase === "sending" ? index : index + 1, total),
        phase,
        error,
      });
    };

    const rememberError = async (id, message) => {
      errors.push({ id, message });
      try {
        await markError(id, message);
      } catch {
        // A local status update must not prevent the remaining uploads.
      }
    };

    for (let index = 0; index < replayIds.length; index += 1) {
      const id = replayIds[index];
      updateProgress(index, "sending");

      const local = await getReplay(id);
      if (!local?.document) {
        processed += 1;
        updateProgress(index, "skipped");
        continue;
      }

      let response;
      try {
        response = await upload(local.document);
      } catch {
        const message = "Hyperdriver indisponível.";
        await rememberError(id, message);
        processed += 1;
        updateProgress(index, "error", message);
        continue;
      }

      const result = await readResponseBody(response);
      if (response.status === 401) {
        const message = result.error || "Sua sessão do Hyperdriver expirou.";
        errors.push({ id, message });
        interrupted = true;
        processed += 1;
        updateProgress(index, "error", message);
        break;
      }

      if (!response.ok) {
        const message = result.error || "O servidor recusou o replay.";
        await rememberError(id, message);
        processed += 1;
        updateProgress(index, "error", message);
        continue;
      }

      await markSynced(id, result);
      uploaded += 1;
      processed += 1;
      updateProgress(index, "uploaded");
    }

    return { uploaded, errors, interrupted, processed, total };
  }

  globalThis.__hyperdriverSync = Object.freeze({
    isReplayLibraryPathname,
    progressPercentage,
    shouldReload,
    serializeReplayDocument,
    synchronizePendingReplays,
  });
})();

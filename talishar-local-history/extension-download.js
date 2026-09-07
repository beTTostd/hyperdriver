export function exportFileName(match) {
  const date = (match.startedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `talishar-history-${date}-${match.id.slice(0, 8)}.json`;
}

export function createDownloadManager({
  loadMatch,
  compactMatch,
  startDownload,
  createObjectUrl,
  revokeObjectUrl,
  notify,
  now = () => new Date().toISOString(),
}) {
  const activeJobs = new Map();
  let queue = Promise.resolve();

  async function run(job) {
    let objectUrl = null;
    let result;
    try {
      const storedMatch = await loadMatch(job.matchId);
      if (!storedMatch) throw new Error("Partida não encontrada.");

      const exportedAt = now();
      const match = compactMatch(storedMatch);
      match.exportedAt = exportedAt;
      const document = { schemaVersion: match.schemaVersion, exportedAt, match };
      const blob = new Blob([JSON.stringify(document)], { type: "application/json" });
      objectUrl = createObjectUrl(blob);
      const filename = exportFileName(match);
      const downloadId = await startDownload(objectUrl, filename);
      result = {
        type: "export-job-status",
        status: "started",
        jobId: job.jobId,
        matchId: job.matchId,
        exportedAt,
        filename,
        downloadId,
      };
    } catch (error) {
      result = {
        type: "export-job-status",
        status: "error",
        jobId: job.jobId,
        matchId: job.matchId,
        error: error instanceof Error ? error.message : "Não foi possível preparar o download.",
      };
    } finally {
      if (objectUrl) revokeObjectUrl(objectUrl);
    }
    await notify(result);
  }

  function enqueue(matchId, requestedJobId) {
    const active = activeJobs.get(matchId);
    if (active) return { jobId: active.jobId, deduplicated: true };

    const job = { matchId, jobId: requestedJobId };
    activeJobs.set(matchId, job);
    queue = queue
      .catch(() => undefined)
      .then(() => run(job))
      .finally(() => {
        if (activeJobs.get(matchId) === job) activeJobs.delete(matchId);
      });
    return { jobId: job.jobId, deduplicated: false };
  }

  return { enqueue };
}

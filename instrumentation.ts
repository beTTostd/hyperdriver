export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAnalysisWorker } = await import("./lib/analysis-queue");
  startAnalysisWorker();
}

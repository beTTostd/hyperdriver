import { enqueueAnalysisJob, getAnalysisQueueSummary } from "../../../../lib/analysis-queue";
import { getCurrentUser } from "../../../../lib/auth";
import { collectiveAnalysisConfiguration } from "../../../../lib/decision-analysis";
import {
  jsonBodyErrorResponse,
  originError,
  privateJson,
  readJsonObjectBody,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../lib/http";
import { findAdminReplay } from "../../../../lib/replays";

export const runtime = "nodejs";

async function requireApiAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: privateJson({ error: "Autenticação necessária." }, { status: 401 }) };
  if (user.role !== "admin") return { error: privateJson({ error: "Acesso administrativo necessário." }, { status: 403 }) };
  return { user };
}

async function getJobs() {
  const auth = await requireApiAdmin();
  if (auth.error) return auth.error;
  return privateJson({
    queue: getAnalysisQueueSummary(),
    collectiveAnalysis: collectiveAnalysisConfiguration(),
  });
}

async function reprocessJob(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const auth = await requireApiAdmin();
  if (auth.error) return auth.error;
  try {
    const body = await readJsonObjectBody(request);
    const replayId = typeof body.replayId === "string" || typeof body.replayId === "number"
      ? String(body.replayId)
      : "";
    const replay = findAdminReplay(replayId);
    if (!replay) return privateJson({ error: "Replay não encontrado." }, { status: 404 });
    if (replay.participation === "watched") {
      return privateJson({ error: "Replays assistidos não são analisados." }, { status: 409 });
    }
    enqueueAnalysisJob(replay.id);
    return privateJson({ ok: true, replayId: replay.sourceMatchId, queue: getAnalysisQueueSummary() });
  } catch (error) {
    return jsonBodyErrorResponse(error)
      ?? privateJson({ error: "Não foi possível reenfileirar a análise." }, { status: 500 });
  }
}

export const GET = withApiLogging("/api/admin/analysis-jobs", getJobs);
export const POST = withApiLogging("/api/admin/analysis-jobs", reprocessJob);

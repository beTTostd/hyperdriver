import { getCurrentUser } from "../../../../../../lib/auth";
import {
  decisionAnalysisVisibleTo,
  saveAnalysisFeedback,
} from "../../../../../../lib/decision-analysis";
import {
  jsonBodyErrorResponse,
  originError,
  privateJson,
  readJsonObjectBody,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../../../lib/http";
import { findAdminReplay, findUserReplay } from "../../../../../../lib/replays";

export const runtime = "nodejs";

const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;

async function submitFeedback(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validateMutationOrigin(request)) return originError();

  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  }
  if (!decisionAnalysisVisibleTo(user.role)) {
    return privateJson({ error: "Replay não encontrado." }, { status: 404 });
  }

  const { id } = await context.params;
  if (!REPLAY_ID_PATTERN.test(id)) {
    return privateJson({ error: "Replay não encontrado." }, { status: 404 });
  }
  const replay = user.role === "admin" ? findAdminReplay(id) : findUserReplay(user.id, id);
  if (!replay) {
    return privateJson({ error: "Replay não encontrado." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectBody(request);
  } catch (error) {
    const response = jsonBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (
    typeof body.helpful !== "boolean"
    || typeof body.analysisFingerprint !== "string"
    || !FINGERPRINT_PATTERN.test(body.analysisFingerprint)
  ) {
    return privateJson({ error: "Feedback inválido." }, { status: 400 });
  }

  const saved = saveAnalysisFeedback({
    replayId: replay.id,
    userId: user.id,
    analysisFingerprint: body.analysisFingerprint,
    helpful: body.helpful,
  });
  if (!saved) {
    return privateJson({ error: "Análise não encontrada." }, { status: 404 });
  }

  return privateJson({ ok: true });
}

export const POST = withApiLogging("/api/replays/:id/analysis/feedback", submitFeedback);

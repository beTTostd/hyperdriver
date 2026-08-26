import { getCurrentUser } from "../../../../../../lib/auth";
import {
  decisionAnalysisVisibleTo,
  saveAnalysisFeedback,
} from "../../../../../../lib/decision-analysis";
import {
  originError,
  privateJson,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../../../lib/http";
import { findAdminReplay } from "../../../../../../lib/replays";

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
  const replay = findAdminReplay(id);
  if (!replay) {
    return privateJson({ error: "Replay não encontrado." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "Feedback inválido." }, { status: 400 });
  }
  if (
    !body
    || typeof body !== "object"
    || typeof (body as { helpful?: unknown }).helpful !== "boolean"
    || typeof (body as { analysisFingerprint?: unknown }).analysisFingerprint !== "string"
    || !FINGERPRINT_PATTERN.test((body as { analysisFingerprint: string }).analysisFingerprint)
  ) {
    return privateJson({ error: "Feedback inválido." }, { status: 400 });
  }

  const saved = saveAnalysisFeedback({
    replayId: replay.id,
    userId: user.id,
    analysisFingerprint: (body as { analysisFingerprint: string }).analysisFingerprint,
    helpful: (body as { helpful: boolean }).helpful,
  });
  if (!saved) {
    return privateJson({ error: "Análise não encontrada." }, { status: 404 });
  }

  return privateJson({ ok: true });
}

export const POST = withApiLogging("/api/replays/:id/analysis/feedback", submitFeedback);

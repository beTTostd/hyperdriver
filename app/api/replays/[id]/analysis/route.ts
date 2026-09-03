import { getCurrentUser } from "../../../../../lib/auth";
import {
  decisionAnalysisVisibleTo,
  getReplayDecisionAnalysis,
} from "../../../../../lib/decision-analysis";
import { privateJson, withApiLogging } from "../../../../../lib/http";
import { findAdminReplay, findUserReplay } from "../../../../../lib/replays";

export const runtime = "nodejs";

const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

async function getAnalysis(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
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

  return privateJson(getReplayDecisionAnalysis(replay, user.role));
}

export const GET = withApiLogging("/api/replays/:id/analysis", getAnalysis);

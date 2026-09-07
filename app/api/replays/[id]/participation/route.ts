import { after } from "next/server";
import { getCurrentUser } from "../../../../../lib/auth";
import { processReplayAnalysis } from "../../../../../lib/decision-analysis";
import {
  jsonBodyErrorResponse,
  originError,
  privateJson,
  readJsonObjectBody,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../../lib/http";
import {
  type ReplayParticipation,
  updateReplayParticipation,
} from "../../../../../lib/replays";

export const runtime = "nodejs";

const validParticipations = new Set<ReplayParticipation>(["played", "watched", "unknown"]);

async function patchParticipation(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  }

  try {
    const body = await readJsonObjectBody(request);
    if (typeof body.participation !== "string" || !validParticipations.has(body.participation as ReplayParticipation)) {
      return privateJson({ error: "Participação inválida." }, { status: 400 });
    }
    const result = updateReplayParticipation(
      user.id,
      user.role,
      (await context.params).id,
      body.participation as ReplayParticipation,
    );
    if (!result) {
      return privateJson({ error: "Replay não encontrado." }, { status: 404 });
    }
    if (result.analysisNeeded) {
      after(async () => {
        try {
          await processReplayAnalysis(result.replay.id);
        } catch {
          console.error(JSON.stringify({
            level: "error",
            type: "replay_decision_analysis_failed",
            replayId: result.replay.id,
          }));
        }
      });
    }
    return privateJson({
      ok: true,
      participation: result.replay.participation,
      participationSource: result.replay.participationSource,
    });
  } catch (error) {
    const response = jsonBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export const PATCH = withApiLogging("/api/replays/:id/participation", patchParticipation);

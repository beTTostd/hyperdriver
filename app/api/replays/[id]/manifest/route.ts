import { getCurrentUser } from "../../../../../lib/auth";
import { privateJson, withApiLogging } from "../../../../../lib/http";
import { REPLAY_API_CONTRACT_VERSION, type ReplayManifest } from "../../../../../lib/replay-contract";
import { findAdminReplay, findUserReplay } from "../../../../../lib/replays";

export const runtime = "nodejs";
const FRAME_PAGE_SIZE = 100;
const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

async function getManifest(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { id } = await context.params;
  if (!REPLAY_ID_PATTERN.test(id)) return privateJson({ error: "Replay não encontrado.", code: "REPLAY_NOT_FOUND" }, { status: 404 });
  const replay = user.role === "admin" ? findAdminReplay(id) : findUserReplay(user.id, id);
  if (!replay) return privateJson({ error: "Replay não encontrado.", code: "REPLAY_NOT_FOUND" }, { status: 404 });
  const manifest: ReplayManifest = {
    contractVersion: REPLAY_API_CONTRACT_VERSION,
    replaySchemaVersion: replay.schemaVersion,
    id: replay.sourceMatchId,
    status: replay.status,
    result: replay.result,
    startedAt: replay.startedAt,
    endedAt: replay.endedAt,
    frameCount: replay.frameCount,
    framePageSize: FRAME_PAGE_SIZE,
  };
  return privateJson(manifest);
}

export const GET = withApiLogging("/api/replays/:id/manifest", getManifest);

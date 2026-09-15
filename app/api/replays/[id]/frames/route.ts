import { getCurrentUser } from "../../../../../lib/auth";
import { privateJson, withApiLogging } from "../../../../../lib/http";
import { REPLAY_API_CONTRACT_VERSION, type ReplayFramePage } from "../../../../../lib/replay-contract";
import { readAdminReplay, readUserReplay } from "../../../../../lib/replays";

export const runtime = "nodejs";
const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

async function getFrames(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { id } = await context.params;
  if (!REPLAY_ID_PATTERN.test(id)) return privateJson({ error: "Replay não encontrado.", code: "REPLAY_NOT_FOUND" }, { status: 404 });
  const replay = user.role === "admin" ? await readAdminReplay(id) : await readUserReplay(user.id, id);
  if (!replay) return privateJson({ error: "Replay não encontrado.", code: "REPLAY_NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const cursor = Number(url.searchParams.get("cursor") || "0");
  const requestedLimit = Number(url.searchParams.get("limit") || "100");
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return privateJson({ error: "Cursor de frames inválido.", code: "INVALID_FRAME_CURSOR" }, { status: 400 });
  }
  const limit = Math.min(requestedLimit, 200);
  const document = JSON.parse(replay.raw);
  const allFrames = Array.isArray(document?.match?.frames) ? document.match.frames : [];
  const frames = allFrames.slice(cursor, cursor + limit);
  const next = cursor + frames.length;
  const page: ReplayFramePage = {
    contractVersion: REPLAY_API_CONTRACT_VERSION,
    replaySchemaVersion: replay.metadata.schemaVersion,
    start: cursor,
    frames,
    nextCursor: next < allFrames.length ? String(next) : null,
  };
  return privateJson(page);
}

export const GET = withApiLogging("/api/replays/:id/frames", getFrames);

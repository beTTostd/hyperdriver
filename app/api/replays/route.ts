import { getCurrentUser } from "../../../lib/auth";
import {
  originError,
  privateJson,
  rateLimitIdentity,
  rateLimitedResponse,
  readRequestBody,
  validateMutationOrigin,
  withApiLogging,
} from "../../../lib/http";
import { acquireUploadLease, consumeRateLimit, releaseUploadLease } from "../../../lib/rate-limit";
import {
  MAX_REPLAY_BYTES,
  ReplayUploadError,
  saveReplayUpload,
} from "../../../lib/replays";

export const runtime = "nodejs";

async function uploadReplay(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return privateJson({ error: "Envie o replay como JSON." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPLAY_BYTES) {
    return privateJson({ error: "O replay excede o limite de 50 MB." }, { status: 413 });
  }

  const uploadLimit = consumeRateLimit("replay-upload", rateLimitIdentity(String(user.id)), 100, 60 * 60 * 1000);
  if (!uploadLimit.allowed) return rateLimitedResponse(uploadLimit.retryAfter);
  const lease = acquireUploadLease(user.id);
  if (!lease) return rateLimitedResponse(5, "Há dois replays sendo processados. Tente novamente em instantes.");

  try {
    const raw = await readRequestBody(request, MAX_REPLAY_BYTES);
    const { replay, duplicate } = await saveReplayUpload(user.id, raw);
    return privateJson(
      { ok: true, replayId: replay.sourceMatchId, username: user.username, duplicate },
      { status: duplicate ? 200 : 201 },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "BODY_TOO_LARGE") {
      return privateJson({ error: "O replay excede o limite de 50 MB." }, { status: 413 });
    }
    if (error instanceof TypeError) {
      return privateJson({ error: "O arquivo enviado não contém UTF-8 válido." }, { status: 400 });
    }
    if (error instanceof ReplayUploadError) {
      return privateJson({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(JSON.stringify({ level: "error", type: "replay_upload_failed", userId: user.id }));
    return privateJson({ error: "Não foi possível salvar o replay." }, { status: 500 });
  } finally {
    releaseUploadLease(lease);
  }
}

export const POST = withApiLogging("/api/replays", uploadReplay);

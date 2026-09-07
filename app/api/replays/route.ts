import { after } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { processReplayAnalysis } from "../../../lib/decision-analysis";
import {
  originError,
  privateJson,
  rateLimitIdentity,
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
import {
  classifyUploadAttempt,
  recordUploadEvent,
  sanitizeTechnicalMessage,
} from "../../../lib/upload-telemetry";

export const runtime = "nodejs";

async function uploadReplay(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  }
  const extensionVersion = request.headers.get("x-hyperdriver-extension-version")?.match(/^\d+\.\d+\.\d+$/)?.[0] ?? null;
  const uploadContext = () => {
    const values = [
      extensionVersion ? `extensão ${extensionVersion}` : null,
      request.headers.get("content-length") ? `${request.headers.get("content-length")} bytes declarados` : null,
    ].filter(Boolean);
    return values.length ? ` (${values.join(", ")})` : "";
  };
  const respond = (
    body: unknown,
    init: ResponseInit,
    telemetry: {
      category: Parameters<typeof recordUploadEvent>[0]["category"];
      httpStatus: number;
      sourceMatchId?: string | null;
      replayId?: number | null;
      errorCode?: string | null;
      technicalMessage?: string | null;
    },
  ) => {
    try {
      recordUploadEvent({ userId: user.id, ...telemetry });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", type: "replay_upload_telemetry_failed", userId: user.id, message: sanitizeTechnicalMessage((error as Error).message) }));
    }
    return privateJson(body, init);
  };

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return respond({ error: "Envie o replay como JSON." }, { status: 415 }, {
      category: "error",
      httpStatus: 415,
      errorCode: "INVALID_CONTENT_TYPE",
      technicalMessage: "O content-type da requisição não é application/json.",
    });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPLAY_BYTES) {
    return respond({ error: "O replay excede o limite de 50 MB.", code: "BODY_TOO_LARGE" }, { status: 413 }, {
      category: "error",
      httpStatus: 413,
      errorCode: "BODY_TOO_LARGE",
      technicalMessage: "O corpo da requisição excedeu o limite de 50 MB.",
    });
  }

  let lease: string | null = null;

  try {
    const uploadLimit = consumeRateLimit("replay-upload", rateLimitIdentity(String(user.id)), 100, 60 * 60 * 1000);
    if (!uploadLimit.allowed) {
      const response = respond({ error: "Muitas tentativas. Tente novamente mais tarde.", code: "RATE_LIMITED" }, { status: 429 }, {
        category: "error",
        httpStatus: 429,
        errorCode: "RATE_LIMITED",
        technicalMessage: "O limite de uploads por hora foi atingido.",
      });
      response.headers.set("retry-after", String(Math.max(1, Math.ceil(uploadLimit.retryAfter))));
      return response;
    }
    lease = acquireUploadLease(user.id);
    if (!lease) {
      const response = respond({ error: "Há dois replays sendo processados. Tente novamente em instantes.", code: "UPLOAD_CONCURRENCY_LIMIT" }, { status: 429 }, {
        category: "error",
        httpStatus: 429,
        errorCode: "UPLOAD_CONCURRENCY_LIMIT",
        technicalMessage: "O limite de uploads simultâneos foi atingido.",
      });
      response.headers.set("retry-after", "5");
      return response;
    }
    const raw = await readRequestBody(request, MAX_REPLAY_BYTES);
    const { replay, duplicate, document, analysisNeeded } = await saveReplayUpload(user.id, raw);
    if (analysisNeeded) {
      after(async () => {
        try {
          await processReplayAnalysis(replay.id, document);
        } catch {
          console.error(JSON.stringify({
            level: "error",
            type: "replay_decision_analysis_failed",
            replayId: replay.id,
          }));
        }
      });
    }
    const category = classifyUploadAttempt({ document, duplicate });
    return respond(
      { ok: true, replayId: replay.sourceMatchId, username: user.username, duplicate },
      { status: duplicate ? 200 : 201 },
      {
        category,
        httpStatus: duplicate ? 200 : 201,
        sourceMatchId: document.match.id,
        replayId: replay.id,
        technicalMessage: duplicate ? "Upload repetido para uma partida já registrada." : null,
      },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "BODY_TOO_LARGE") {
      return respond({ error: "O replay excede o limite de 50 MB.", code: "BODY_TOO_LARGE" }, { status: 413 }, {
        category: "error",
        httpStatus: 413,
        errorCode: "BODY_TOO_LARGE",
        technicalMessage: "O corpo da requisição excedeu o limite de 50 MB.",
      });
    }
    if ((error as { code?: string }).code === "BODY_TRUNCATED") {
      const bodyError = error as Error & { declaredBytes?: number; receivedBytes?: number };
      return respond({ error: "O upload chegou incompleto. Tente novamente.", code: "BODY_TRUNCATED" }, { status: 400 }, {
        category: "truncated",
        httpStatus: 400,
        errorCode: "BODY_TRUNCATED",
        technicalMessage: `Corpo incompleto: ${bodyError.receivedBytes ?? "?"} de ${bodyError.declaredBytes ?? "?"} bytes recebidos${uploadContext()}.`,
      });
    }
    if (error instanceof TypeError) {
      return respond({ error: "O arquivo enviado não contém UTF-8 válido.", code: "INVALID_UTF8" }, { status: 400 }, {
        category: "corrupt",
        httpStatus: 400,
        errorCode: "INVALID_UTF8",
        technicalMessage: `${error.message}${uploadContext()}`,
      });
    }
    if (error instanceof ReplayUploadError) {
      const category = classifyUploadAttempt({ document: error.document, errorCode: error.code });
      return respond({ error: error.message, code: error.code }, { status: error.status }, {
        category,
        httpStatus: error.status,
        sourceMatchId: error.sourceMatchId,
        errorCode: error.code || "UPLOAD_REJECTED",
        technicalMessage: `${error.message}${uploadContext()}`,
      });
    }
    console.error(JSON.stringify({ level: "error", type: "replay_upload_failed", userId: user.id }));
    return respond({ error: "Não foi possível salvar o replay.", code: "UNEXPECTED_ERROR" }, { status: 500 }, {
      category: "error",
      httpStatus: 500,
      errorCode: "UNEXPECTED_ERROR",
      technicalMessage: (error as Error)?.message,
    });
  } finally {
    if (lease) releaseUploadLease(lease);
  }
}

export const POST = withApiLogging("/api/replays", uploadReplay);

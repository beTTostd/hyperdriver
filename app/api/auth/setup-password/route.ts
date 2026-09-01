import { consumePasswordSetup, validatePassword } from "../../../../lib/auth";
import {
  clientIp,
  jsonBodyErrorResponse,
  originError,
  privateJson,
  rateLimitIdentity,
  rateLimitedResponse,
  readJsonObjectBody,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../lib/http";
import { consumeRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

async function setupPassword(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const limit = consumeRateLimit(
    "password-setup-ip",
    rateLimitIdentity(clientIp(request)),
    10,
    60 * 60 * 1000,
  );
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);
  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectBody(request);
  } catch (error) {
    const response = jsonBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
  const passwordError = validatePassword(password);

  if (passwordError) return privateJson({ error: passwordError }, { status: 400 });
  if (password !== confirmation) {
    return privateJson({ error: "As senhas não coincidem." }, { status: 400 });
  }
  if (!token || !await consumePasswordSetup(token, password)) {
    return privateJson(
      { error: "Este link é inválido, expirou ou já foi utilizado." },
      { status: 400 },
    );
  }

  return privateJson({ ok: true });
}

export const POST = withApiLogging("/api/auth/setup-password", setupPassword);

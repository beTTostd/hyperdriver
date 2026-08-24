import { consumePasswordSetup, validatePassword } from "../../../../lib/auth";
import {
  clientIp,
  originError,
  privateJson,
  rateLimitIdentity,
  rateLimitedResponse,
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
  const body = await readBody(request);
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

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

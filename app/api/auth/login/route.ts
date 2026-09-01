import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { MAX_PASSWORD_LENGTH } from "../../../../lib/password-policy";
import {
  createSession,
  normalizeUsername,
  safeRelativePath,
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  secureCookie,
  verifyPassword,
} from "../../../../lib/auth";
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
import { checkRateLimit, recordRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

const DUMMY_PASSWORD_HASH = `scrypt$00000000000000000000000000000000$${"0".repeat(128)}`;

async function login(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectBody(request);
  } catch (error) {
    const response = jsonBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";
  const ipIdentity = rateLimitIdentity(clientIp(request));
  const userIdentity = rateLimitIdentity(username || "invalid");
  const ipLimit = checkRateLimit("login-ip-failure", ipIdentity, 30, 15 * 60 * 1000);
  const userLimit = checkRateLimit("login-user-failure", userIdentity, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed || !userLimit.allowed) {
    return rateLimitedResponse(Math.max(ipLimit.retryAfter, userLimit.retryAfter));
  }
  const user = username
    ? getDb().select().from(users).where(eq(users.username, username)).get()
    : null;

  const passwordValid = await verifyPassword(
    password.length <= MAX_PASSWORD_LENGTH ? password : "",
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !user.isActive || !passwordValid) {
    recordRateLimit("login-ip-failure", ipIdentity);
    recordRateLimit("login-user-failure", userIdentity);
    return privateJson({ error: "Username ou senha inválidos." }, { status: 401 });
  }

  const token = createSession(user.id);
  const response = privateJson({
    ok: true,
    redirectTo: safeRelativePath(typeof body?.returnTo === "string" ? body.returnTo : "/replays"),
  });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    path: "/",
  });
  return response;
}

export const POST = withApiLogging("/api/auth/login", login);

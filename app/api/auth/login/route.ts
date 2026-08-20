import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import {
  createSession,
  normalizeUsername,
  safeRelativePath,
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  secureCookie,
  verifyPassword,
} from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";
  const user = username
    ? getDb().select().from(users).where(eq(users.username, username)).get()
    : null;

  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Username ou senha inválidos." }, { status: 401 });
  }

  const token = createSession(user.id);
  const response = NextResponse.json({
    ok: true,
    redirectTo: safeRelativePath(typeof body?.returnTo === "string" ? body.returnTo : "/me"),
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

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

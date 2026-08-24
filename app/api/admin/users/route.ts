import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { passwordSetupTokens, users } from "../../../../db/schema";
import {
  appUrl,
  createOpaqueToken,
  getCurrentUser,
  hashToken,
  isValidUsername,
  PASSWORD_SETUP_DURATION_MS,
  normalizeUsername,
} from "../../../../lib/auth";
import { originError, privateJson, validateMutationOrigin, withApiLogging } from "../../../../lib/http";

export const runtime = "nodejs";

async function createUser(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return privateJson({ error: "Acesso negado." }, { status: 403 });
  }

  const body = await readBody(request);
  const username = normalizeUsername(body?.username);
  const role = body?.role;
  if (!isValidUsername(username)) {
    return privateJson(
      { error: "Username deve ter de 3 a 50 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado." },
      { status: 400 },
    );
  }
  if (role !== "admin" && role !== "user") {
    return privateJson({ error: "Role inválida." }, { status: 400 });
  }

  let origin: string;
  try {
    origin = appUrl();
  } catch (error) {
    return privateJson(
      { error: error instanceof Error ? error.message : "APP_URL não configurado." },
      { status: 500 },
    );
  }

  const token = createOpaqueToken();
  const expiresAt = Date.now() + PASSWORD_SETUP_DURATION_MS;
  let createdId: number;
  try {
    const created = getDb().transaction((database) => {
      const existing = database.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
      if (existing) return null;
      const inserted = database
        .insert(users)
        .values({ username, role })
        .returning({ id: users.id })
        .get();
      database.insert(passwordSetupTokens).values({
        userId: inserted.id,
        tokenHash: hashToken(token),
        expiresAt,
      }).run();
      return inserted;
    });

    if (!created) {
      return privateJson({ error: "Este username já está em uso." }, { status: 409 });
    }
    createdId = created.id;
  } catch {
    return privateJson({ error: "Não foi possível criar o usuário." }, { status: 500 });
  }

  return privateJson({
    ok: true,
    id: createdId,
    username,
    role,
    expiresAt,
    setupUrl: `${origin}/set-password#token=${encodeURIComponent(token)}`,
  }, { status: 201 });
}

export const POST = withApiLogging("/api/admin/users", createUser);

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

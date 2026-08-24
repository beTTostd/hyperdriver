import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { passwordSetupTokens, users } from "../../../../../../db/schema";
import {
  appUrl,
  createOpaqueToken,
  getCurrentUser,
  hashToken,
  PASSWORD_SETUP_DURATION_MS,
} from "../../../../../../lib/auth";
import { originError, privateJson, validateMutationOrigin, withApiLogging } from "../../../../../../lib/http";

export const runtime = "nodejs";

async function createPasswordLink(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validateMutationOrigin(request)) return originError();
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return privateJson({ error: "Acesso negado." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return privateJson({ error: "Usuário não encontrado." }, { status: 404 });
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

  const userId = Number(id);
  const token = createOpaqueToken();
  const expiresAt = Date.now() + PASSWORD_SETUP_DURATION_MS;
  const target = getDb().transaction((database) => {
    const existing = database
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!existing) return null;

    database
      .delete(passwordSetupTokens)
      .where(eq(passwordSetupTokens.userId, userId))
      .run();
    database.insert(passwordSetupTokens).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    }).run();
    return existing;
  });

  if (!target) {
    return privateJson({ error: "Usuário não encontrado." }, { status: 404 });
  }

  return privateJson({
    ok: true,
    username: target.username,
    expiresAt,
    setupUrl: `${origin}/set-password#token=${encodeURIComponent(token)}`,
  });
}

export const POST = withApiLogging("/api/admin/users/:id/password-link", createPasswordLink);

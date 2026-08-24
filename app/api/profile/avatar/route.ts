import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { getCurrentUser } from "../../../../lib/auth";
import { isValidCardAvatar, normalizeCardAvatar } from "../../../../lib/card-avatars";
import { originError, privateJson, validateMutationOrigin, withApiLogging } from "../../../../lib/http";

export const runtime = "nodejs";

async function updateAvatar(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return privateJson({ error: "Você precisa estar autenticado." }, { status: 401 });
  }

  const body = await readBody(request);
  const avatarCardId = normalizeCardAvatar(body?.cardId);
  if (!isValidCardAvatar(avatarCardId)) {
    return privateJson({ error: "Use o ID de uma carta FAB válido." }, { status: 400 });
  }

  getDb()
    .update(users)
    .set({ avatarCardId, updatedAt: Date.now() })
    .where(eq(users.id, currentUser.id))
    .run();

  return privateJson({ ok: true, avatarCardId });
}

export const POST = withApiLogging("/api/profile/avatar", updateAvatar);

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

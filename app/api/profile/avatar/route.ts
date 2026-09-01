import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { getCurrentUser } from "../../../../lib/auth";
import { isValidCardAvatar, normalizeCardAvatar } from "../../../../lib/card-avatars";
import {
  jsonBodyErrorResponse,
  originError,
  privateJson,
  readJsonObjectBody,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../lib/http";

export const runtime = "nodejs";

async function updateAvatar(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return privateJson({ error: "Você precisa estar autenticado." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectBody(request);
  } catch (error) {
    const response = jsonBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
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

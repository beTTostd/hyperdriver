import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { passwordSetupTokens, replays, sessions, users } from "../../../../../db/schema";
import { getCurrentUser } from "../../../../../lib/auth";
import { originError, privateJson, validateMutationOrigin, withApiLogging } from "../../../../../lib/http";
import {
  deleteQuarantinedReplayFiles,
  quarantineReplayFiles,
  restoreReplayFiles,
} from "../../../../../lib/replays";

export const runtime = "nodejs";

async function deleteUser(
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

  const userId = Number(id);
  if (userId === currentUser.id) {
    return privateJson(
      { error: "Você não pode apagar a própria conta administrativa." },
      { status: 400 },
    );
  }

  const target = getDb()
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .get();
  if (!target) return privateJson({ error: "Usuário não encontrado." }, { status: 404 });

  const storageKeys = getDb()
      .select({ storageKey: replays.storageKey })
      .from(replays)
      .where(eq(replays.userId, userId))
      .all()
      .map((replay) => replay.storageKey);
  let quarantined;
  try {
    quarantined = await quarantineReplayFiles(storageKeys);
  } catch {
    return privateJson({ error: "Não foi possível preparar os replays para exclusão." }, { status: 500 });
  }

  try {
    getDb().transaction((database) => {
      database.delete(passwordSetupTokens).where(eq(passwordSetupTokens.userId, userId)).run();
      database.delete(sessions).where(eq(sessions.userId, userId)).run();
      database.delete(replays).where(eq(replays.userId, userId)).run();
      const deleted = database.delete(users).where(eq(users.id, userId)).run();
      if (deleted.changes !== 1) throw new Error("User changed during deletion.");
    });
  } catch {
    await restoreReplayFiles(quarantined);
    return privateJson({ error: "Não foi possível apagar o usuário." }, { status: 500 });
  }

  await deleteQuarantinedReplayFiles(quarantined).catch(() => undefined);
  return privateJson({ ok: true, id: target.id, username: target.username });
}

export const DELETE = withApiLogging("/api/admin/users/:id", deleteUser);

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../db";
import { passwordSetupTokens, replays, sessions, users } from "../../../../../db/schema";
import { getCurrentUser } from "../../../../../lib/auth";
import { deleteReplayFiles } from "../../../../../lib/replays";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  const userId = Number(id);
  if (userId === currentUser.id) {
    return NextResponse.json(
      { error: "Você não pode apagar a própria conta administrativa." },
      { status: 400 },
    );
  }

  const deleted = getDb().transaction((database) => {
    const target = database
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!target) return null;

    const storageKeys = database
      .select({ storageKey: replays.storageKey })
      .from(replays)
      .where(eq(replays.userId, userId))
      .all()
      .map((replay) => replay.storageKey);

    database.delete(passwordSetupTokens).where(eq(passwordSetupTokens.userId, userId)).run();
    database.delete(sessions).where(eq(sessions.userId, userId)).run();
    database.delete(replays).where(eq(replays.userId, userId)).run();
    database.delete(users).where(eq(users.id, userId)).run();
    return { ...target, storageKeys };
  });

  if (!deleted) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  await deleteReplayFiles(deleted.storageKeys);
  return NextResponse.json({ ok: true, id: deleted.id, username: deleted.username });
}

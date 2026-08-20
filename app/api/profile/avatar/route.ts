import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { getCurrentUser } from "../../../../lib/auth";
import { isValidCardAvatar, normalizeCardAvatar } from "../../../../lib/card-avatars";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Você precisa estar autenticado." }, { status: 401 });
  }

  const body = await readBody(request);
  const avatarCardId = normalizeCardAvatar(body?.cardId);
  if (!isValidCardAvatar(avatarCardId)) {
    return NextResponse.json({ error: "Use o ID de uma carta FAB válido." }, { status: 400 });
  }

  getDb()
    .update(users)
    .set({ avatarCardId, updatedAt: Date.now() })
    .where(eq(users.id, currentUser.id))
    .run();

  return NextResponse.json({ ok: true, avatarCardId });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

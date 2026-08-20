import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../../db";
import { passwordSetupTokens, users } from "../../../../../../db/schema";
import {
  appUrl,
  createOpaqueToken,
  getCurrentUser,
  hashToken,
  PASSWORD_SETUP_DURATION_MS,
} from "../../../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(
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

  let origin: string;
  try {
    origin = appUrl();
  } catch (error) {
    return NextResponse.json(
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
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    username: target.username,
    expiresAt,
    setupUrl: `${origin}/set-password?token=${encodeURIComponent(token)}`,
  });
}

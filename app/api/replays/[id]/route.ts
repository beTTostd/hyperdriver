import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { readAdminReplay, readUserReplay } from "../../../../lib/replays";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) && !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Replay não encontrado." }, { status: 404 });
  }
  const replay = user.role === "admin"
    ? await readAdminReplay(id)
    : await readUserReplay(user.id, id);
  if (!replay) {
    return NextResponse.json({ error: "Replay não encontrado." }, { status: 404 });
  }
  return new NextResponse(replay.raw, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

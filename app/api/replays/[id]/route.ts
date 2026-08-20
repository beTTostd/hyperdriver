import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { readUserReplay } from "../../../../lib/replays";

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
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Replay não encontrado." }, { status: 404 });
  }
  const replay = await readUserReplay(user.id, Number(id));
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

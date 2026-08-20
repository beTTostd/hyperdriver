import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import {
  MAX_REPLAY_BYTES,
  ReplayUploadError,
  saveReplayUpload,
} from "../../../lib/replays";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Envie o replay como JSON." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPLAY_BYTES) {
    return NextResponse.json({ error: "O replay excede o limite de 50 MB." }, { status: 413 });
  }

  try {
    const raw = await request.text();
    const { replay, duplicate } = await saveReplayUpload(user.id, raw);
    return NextResponse.json(
      { ok: true, replayId: replay.sourceMatchId, username: user.username, duplicate },
      { status: duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ReplayUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to save replay upload", error);
    return NextResponse.json({ error: "Não foi possível salvar o replay." }, { status: 500 });
  }
}

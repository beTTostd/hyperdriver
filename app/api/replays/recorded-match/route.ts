import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  }
  const replay = await readFile(resolve("public/replays/recorded-match.json"), "utf8");
  return new NextResponse(replay, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { privateJson, withApiLogging } from "../../../../lib/http";

export const runtime = "nodejs";

async function getRecordedMatch(request: Request) {
  void request;
  if (!(await getCurrentUser())) {
    return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  }
  const replay = await readFile(resolve("public/replays/recorded-match.json"), "utf8");
  return new NextResponse(replay, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export const GET = withApiLogging("/api/replays/recorded-match", getRecordedMatch);

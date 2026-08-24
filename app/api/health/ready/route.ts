import { NextResponse } from "next/server";
import { getSqlite } from "../../../../db";
import { getReplayStorage } from "../../../../lib/replay-storage";
import { appUrl } from "../../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let databaseReady = false;
  try {
    const result = getSqlite().prepare("SELECT 1 AS ready").get() as { ready?: number } | undefined;
    databaseReady = result?.ready === 1;
  } catch {
    databaseReady = false;
  }
  const storageReady = await getReplayStorage().ready();
  let configurationReady = false;
  try {
    appUrl();
    configurationReady = true;
  } catch {
    configurationReady = false;
  }
  const ready = databaseReady && storageReady && configurationReady;
  return NextResponse.json({ status: ready ? "ready" : "not_ready" }, {
    status: ready ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

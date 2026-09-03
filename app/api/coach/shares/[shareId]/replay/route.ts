import { NextResponse } from "next/server";
import { authorizeCoachShare, COACH_TOKEN_HEADER, publicReplayData } from "../../../../../../lib/coaching";
import { clientIp, rateLimitIdentity, rateLimitedResponse, withApiLogging } from "../../../../../../lib/http";
import { consumeRateLimit } from "../../../../../../lib/rate-limit";
export const runtime = "nodejs";
async function handler(request: Request, { params }: { params: Promise<{ shareId: string }> }) { const shareId = (await params).shareId; const limit = consumeRateLimit("coach-token", rateLimitIdentity(`${clientIp(request)}:${shareId}`), 60, 60_000); if (!limit.allowed) return rateLimitedResponse(limit.retryAfter); const share = authorizeCoachShare(shareId, request.headers.get(COACH_TOKEN_HEADER)); const replay = share ? await publicReplayData(share) : null; const response = replay ? NextResponse.json(replay) : NextResponse.json({ error: "Compartilhamento não encontrado." }, { status: 404 }); response.headers.set("cache-control", "private, no-store"); response.headers.set("x-robots-tag", "noindex, nofollow"); response.headers.set("referrer-policy", "no-referrer"); return response; }
export const GET = withApiLogging("/api/coach/shares/:shareId/replay", handler);

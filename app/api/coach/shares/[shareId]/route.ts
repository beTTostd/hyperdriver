import { authorizeCoachShare, COACH_TOKEN_HEADER, publicShareData } from "../../../../../lib/coaching";
import { clientIp, privateJson, rateLimitIdentity, rateLimitedResponse, withApiLogging } from "../../../../../lib/http";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
export const runtime = "nodejs";
function secure(response: Response) { response.headers.set("x-robots-tag", "noindex, nofollow"); response.headers.set("referrer-policy", "no-referrer"); return response; }
async function handler(request: Request, { params }: { params: Promise<{ shareId: string }> }) { const { shareId } = await params; const limit = consumeRateLimit("coach-token", rateLimitIdentity(`${clientIp(request)}:${shareId}`), 60, 60_000); if (!limit.allowed) return secure(rateLimitedResponse(limit.retryAfter)); const share = authorizeCoachShare(shareId, request.headers.get(COACH_TOKEN_HEADER)); return secure(share ? privateJson(publicShareData(share)) : privateJson({ error: "Compartilhamento não encontrado." }, { status: 404 })); }
export const GET = withApiLogging("/api/coach/shares/:shareId", handler);

import { getCurrentUser } from "../../../../../lib/auth";
import { CoachingError, createReplayShare, listReplayShares } from "../../../../../lib/coaching";
import { jsonBodyErrorResponse, originError, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../lib/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function getHandler(_request: Request, { params }: Context) { const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); const result = listReplayShares(user.id, (await params).id); return result ? privateJson({ shares: result }) : privateJson({ error: "Replay não encontrado." }, { status: 404 }); }
async function postHandler(request: Request, { params }: Context) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); try { const result = createReplayShare(user.id, (await params).id, await readJsonObjectBody(request)); return result ? privateJson(result, { status: 201 }) : privateJson({ error: "Replay não encontrado." }, { status: 404 }); } catch (error) { const body = jsonBodyErrorResponse(error); if (body) return body; if (error instanceof CoachingError) return privateJson({ error: error.message }, { status: error.status }); throw error; } }
export const GET = withApiLogging("/api/replays/:id/shares", getHandler);
export const POST = withApiLogging("/api/replays/:id/shares", postHandler);

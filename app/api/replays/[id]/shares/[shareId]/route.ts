import { getCurrentUser } from "../../../../../../lib/auth";
import { changeReplayShare, CoachingError, deleteReplayShare } from "../../../../../../lib/coaching";
import { jsonBodyErrorResponse, originError, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../../lib/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; shareId: string }> };
async function patchHandler(request: Request, { params }: Context) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); try { const values = await params; const result = changeReplayShare(user.id, values.id, values.shareId, await readJsonObjectBody(request)); return result ? privateJson(result) : privateJson({ error: "Compartilhamento não encontrado." }, { status: 404 }); } catch (error) { const body = jsonBodyErrorResponse(error); if (body) return body; if (error instanceof CoachingError) return privateJson({ error: error.message }, { status: error.status }); throw error; } }
async function deleteHandler(request: Request, { params }: Context) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); const values = await params; return deleteReplayShare(user.id, values.id, values.shareId) ? privateJson({ ok: true }) : privateJson({ error: "Compartilhamento não encontrado." }, { status: 404 }); }
export const PATCH = withApiLogging("/api/replays/:id/shares/:shareId", patchHandler);
export const DELETE = withApiLogging("/api/replays/:id/shares/:shareId", deleteHandler);

import { getCurrentUser } from "../../../../../../../lib/auth";
import { ownerChangeThread } from "../../../../../../../lib/coaching";
import { originError, parsePositiveIntegerId, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../../../lib/http";
export const runtime = "nodejs";
async function handler(request: Request, { params }: { params: Promise<{ id: string; threadId: string }> }) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); const values = await params; const threadId = parsePositiveIntegerId(values.threadId); if (!threadId) return privateJson({ error: "Conversa não encontrada." }, { status: 404 }); const body = await readJsonObjectBody(request); const result = ownerChangeThread(user.id, values.id, threadId, body.resolved); return result ? privateJson(result) : privateJson({ error: "Conversa não encontrada." }, { status: 404 }); }
export const PATCH = withApiLogging("/api/replays/:id/coaching/threads/:threadId", handler);

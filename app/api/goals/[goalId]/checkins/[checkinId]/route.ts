import { getCurrentUser } from "../../../../../../lib/auth";
import { deleteGoalCheckin } from "../../../../../../lib/training-goals";
import { originError, parsePositiveIntegerId, privateJson, validateMutationOrigin, withApiLogging } from "../../../../../../lib/http";
export const runtime = "nodejs";
async function handler(request: Request, { params }: { params: Promise<{ goalId: string; checkinId: string }> }) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); const values = await params; const goalId = parsePositiveIntegerId(values.goalId); const checkinId = parsePositiveIntegerId(values.checkinId); return goalId && checkinId && deleteGoalCheckin(user.id, goalId, checkinId) ? privateJson({ ok: true }) : privateJson({ error: "Check-in não encontrado." }, { status: 404 }); }
export const DELETE = withApiLogging("/api/goals/:goalId/checkins/:checkinId", handler);

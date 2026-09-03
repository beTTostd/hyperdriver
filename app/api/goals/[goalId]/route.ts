import { getCurrentUser } from "../../../../lib/auth";
import { getGoal, GoalError, updateGoal } from "../../../../lib/training-goals";
import { jsonBodyErrorResponse, originError, parsePositiveIntegerId, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../lib/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ goalId: string }> };
async function getHandler(_request: Request, { params }: Context) { const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); const id = parsePositiveIntegerId((await params).goalId); const goal = id ? getGoal(user.id, id) : null; return goal ? privateJson(goal) : privateJson({ error: "Meta não encontrada." }, { status: 404 }); }
async function patchHandler(request: Request, { params }: Context) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); const id = parsePositiveIntegerId((await params).goalId); if (!id) return privateJson({ error: "Meta não encontrada." }, { status: 404 }); try { const goal = updateGoal(user.id, id, await readJsonObjectBody(request)); return goal ? privateJson(goal) : privateJson({ error: "Meta não encontrada." }, { status: 404 }); } catch (error) { const body = jsonBodyErrorResponse(error); if (body) return body; if (error instanceof GoalError) return privateJson({ error: error.message }, { status: error.status }); throw error; } }
export const GET = withApiLogging("/api/goals/:goalId", getHandler);
export const PATCH = withApiLogging("/api/goals/:goalId", patchHandler);

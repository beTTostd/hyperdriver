import { getCurrentUser } from "../../../lib/auth";
import { createGoal, GoalError, listGoals } from "../../../lib/training-goals";
import { jsonBodyErrorResponse, originError, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../lib/http";
export const runtime = "nodejs";
async function getHandler() { const user = await getCurrentUser(); return user ? privateJson({ goals: listGoals(user.id) }) : privateJson({ error: "Autenticação necessária." }, { status: 401 }); }
async function postHandler(request: Request) { if (!validateMutationOrigin(request)) return originError(); const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 }); try { return privateJson(createGoal(user.id, await readJsonObjectBody(request)), { status: 201 }); } catch (error) { const body = jsonBodyErrorResponse(error); if (body) return body; if (error instanceof GoalError) return privateJson({ error: error.message }, { status: error.status }); throw error; } }
export const GET = withApiLogging("/api/goals", getHandler);
export const POST = withApiLogging("/api/goals", postHandler);

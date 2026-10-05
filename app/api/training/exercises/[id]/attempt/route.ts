import { getCurrentUser } from "../../../../../../lib/auth";
import { jsonBodyErrorResponse, originError, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../../lib/http";
import { savePracticeHelpfulness, submitPracticeAttempt } from "../../../../../../lib/decision-practice";

export const runtime = "nodejs";
async function handler(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(id)) return privateJson({ error: "Exercício não encontrado." }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await readJsonObjectBody(request); } catch (error) {
    const response = jsonBodyErrorResponse(error); if (response) return response; throw error;
  }
  if (body.helpful !== undefined && typeof body.helpful !== "boolean") return privateJson({ error: "Feedback inválido." }, { status: 400 });
  if (body.actionKey === undefined && typeof body.helpful === "boolean") {
    return savePracticeHelpfulness(user.id, id, body.helpful) ? privateJson({ ok: true })
      : privateJson({ error: "Tentativa não encontrada." }, { status: 404 });
  }
  if (typeof body.actionKey !== "string" || body.actionKey.length > 1024) return privateJson({ error: "Escolha inválida." }, { status: 400 });
  const result = submitPracticeAttempt(user.id, id, body.actionKey, body.helpful as boolean | undefined);
  return result ? privateJson(result) : privateJson({ error: "Exercício ou escolha não encontrados." }, { status: 404 });
}
export const POST = withApiLogging("/api/training/exercises/:id/attempt", handler);

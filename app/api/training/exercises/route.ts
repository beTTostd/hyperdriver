import { getCurrentUser } from "../../../../lib/auth";
import { privateJson, withApiLogging } from "../../../../lib/http";
import { listPracticeExercises } from "../../../../lib/decision-practice";

export const runtime = "nodejs";
async function handler() {
  const user = await getCurrentUser();
  return user ? privateJson(listPracticeExercises(user.id)) : privateJson({ error: "Autenticação necessária." }, { status: 401 });
}
export const GET = withApiLogging("/api/training/exercises", handler);

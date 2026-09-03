import { getCurrentUser } from "../../../../lib/auth";
import { privateJson, withApiLogging } from "../../../../lib/http";
import { goalSuggestions } from "../../../../lib/training-goals";
export const runtime = "nodejs";
async function handler() { const user = await getCurrentUser(); return user ? privateJson({ suggestions: goalSuggestions(user.id) }) : privateJson({ error: "Autenticação necessária." }, { status: 401 }); }
export const GET = withApiLogging("/api/goals/suggestions", handler);

import { getCurrentUser } from "../../../../../lib/auth";
import { jsonBodyErrorResponse, originError, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../lib/http";
import { createBookmark, WorkspaceError } from "../../../../../lib/player-workspace";

export const runtime = "nodejs";
async function handler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  try {
    const result = createBookmark(user.id, (await params).id, await readJsonObjectBody(request));
    return result ? privateJson(result, { status: 201 }) : privateJson({ error: "Replay não encontrado." }, { status: 404 });
  } catch (error) {
    const bodyError = jsonBodyErrorResponse(error); if (bodyError) return bodyError;
    if (error instanceof WorkspaceError) return privateJson({ error: error.message }, { status: error.status });
    throw error;
  }
}
export const POST = withApiLogging("/api/replays/:id/bookmarks", handler);

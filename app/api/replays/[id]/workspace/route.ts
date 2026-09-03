import { getCurrentUser } from "../../../../../lib/auth";
import { jsonBodyErrorResponse, originError, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../lib/http";
import { getReplayWorkspace, updateReplayWorkspace, WorkspaceError } from "../../../../../lib/player-workspace";

export const runtime = "nodejs";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  const result = getReplayWorkspace(user.id, (await params).id);
  return result ? privateJson(result) : privateJson({ error: "Replay não encontrado." }, { status: 404 });
}

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  try {
    const result = updateReplayWorkspace(user.id, (await params).id, await readJsonObjectBody(request));
    return result ? privateJson(result) : privateJson({ error: "Replay não encontrado." }, { status: 404 });
  } catch (error) {
    const bodyError = jsonBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error instanceof WorkspaceError) return privateJson({ error: error.message }, { status: error.status });
    throw error;
  }
}

export const GET = withApiLogging("/api/replays/:id/workspace", GETHandler);
export const PATCH = withApiLogging("/api/replays/:id/workspace", PATCHHandler);

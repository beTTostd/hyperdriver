import { getCurrentUser } from "../../../../../../lib/auth";
import { jsonBodyErrorResponse, originError, parsePositiveIntegerId, privateJson, readJsonObjectBody, validateMutationOrigin, withApiLogging } from "../../../../../../lib/http";
import { deleteBookmark, updateBookmark, WorkspaceError } from "../../../../../../lib/player-workspace";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; bookmarkId: string }> };
async function patchHandler(request: Request, { params }: Context) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  const values = await params; const bookmarkId = parsePositiveIntegerId(values.bookmarkId);
  if (!bookmarkId) return privateJson({ error: "Bookmark não encontrado." }, { status: 404 });
  try {
    const result = updateBookmark(user.id, values.id, bookmarkId, await readJsonObjectBody(request));
    return result ? privateJson(result) : privateJson({ error: "Bookmark não encontrado." }, { status: 404 });
  } catch (error) {
    const bodyError = jsonBodyErrorResponse(error); if (bodyError) return bodyError;
    if (error instanceof WorkspaceError) return privateJson({ error: error.message }, { status: error.status });
    throw error;
  }
}
async function deleteHandler(request: Request, { params }: Context) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser(); if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  const values = await params; const bookmarkId = parsePositiveIntegerId(values.bookmarkId);
  return bookmarkId && deleteBookmark(user.id, values.id, bookmarkId) ? privateJson({ ok: true }) : privateJson({ error: "Bookmark não encontrado." }, { status: 404 });
}
export const PATCH = withApiLogging("/api/replays/:id/bookmarks/:bookmarkId", patchHandler);
export const DELETE = withApiLogging("/api/replays/:id/bookmarks/:bookmarkId", deleteHandler);

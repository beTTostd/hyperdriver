import { getCurrentUser } from "../../../lib/auth";
import { privateJson, withApiLogging } from "../../../lib/http";
import { listUserTags } from "../../../lib/player-workspace";
export const runtime = "nodejs";
async function handler() { const user = await getCurrentUser(); return user ? privateJson({ tags: listUserTags(user.id) }) : privateJson({ error: "Autenticação necessária." }, { status: 401 }); }
export const GET = withApiLogging("/api/tags", handler);

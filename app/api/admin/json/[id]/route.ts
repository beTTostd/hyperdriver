import { getCurrentUser } from "../../../../../lib/auth";
import { readAdminJsonFile } from "../../../../../lib/admin-json";
import { parsePositiveIntegerId, privateJson, withApiLogging } from "../../../../../lib/http";

export const runtime = "nodejs";

function contentDisposition(fileName: string): string {
  const fallback = fileName
    .replaceAll(/[\\/\r\n\0"]/g, "_")
    .replaceAll(/[^\x20-\x7e]/g, "_") || "arquivo.json";
  const encoded = encodeURIComponent(fileName).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function downloadJson(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  if (user.role !== "admin") return privateJson({ error: "Acesso administrativo necessário." }, { status: 403 });
  const id = parsePositiveIntegerId((await context.params).id);
  if (!id) return privateJson({ error: "Arquivo não encontrado." }, { status: 404 });
  const result = await readAdminJsonFile(id);
  if (!result) return privateJson({ error: "Arquivo não encontrado." }, { status: 404 });
  const body = new ArrayBuffer(result.contents.byteLength);
  new Uint8Array(body).set(result.contents);
  return new Response(body, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      "content-disposition": contentDisposition(result.file.originalName),
      "content-length": String(result.file.sizeBytes),
      "content-type": "application/json",
    },
  });
}

export const GET = withApiLogging("/api/admin/json/:id", downloadJson);

import { getCurrentUser } from "../../../../lib/auth";
import {
  AdminJsonFileError,
  MAX_ADMIN_JSON_BYTES,
  saveAdminJsonFile,
} from "../../../../lib/admin-json";
import {
  originError,
  privateJson,
  readRequestBytes,
  validateMutationOrigin,
  withApiLogging,
} from "../../../../lib/http";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

async function uploadJson(request: Request) {
  if (!validateMutationOrigin(request)) return originError();
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  if (user.role !== "admin") return privateJson({ error: "Acesso administrativo necessário." }, { status: 403 });

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return privateJson({ error: "Envie o arquivo como formulário multipart." }, { status: 415 });
  }

  try {
    const body = await readRequestBytes(request, MAX_ADMIN_JSON_BYTES + MAX_MULTIPART_OVERHEAD_BYTES);
    const copiedBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(copiedBody).set(body);
    const formData = await new Response(copiedBody, { headers: { "content-type": contentType } }).formData();
    const upload = formData.get("file");
    if (!(upload instanceof File)) {
      return privateJson({ error: "Selecione um arquivo JSON." }, { status: 400 });
    }
    if (upload.size > MAX_ADMIN_JSON_BYTES) {
      return privateJson({ error: "O arquivo excede o limite de 50 MB." }, { status: 413 });
    }
    const file = await saveAdminJsonFile(user.id, upload.name, new Uint8Array(await upload.arrayBuffer()));
    return privateJson({ ok: true, file }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "BODY_TOO_LARGE") {
      return privateJson({ error: "O arquivo excede o limite de 50 MB." }, { status: 413 });
    }
    if ((error as { code?: string }).code === "BODY_TRUNCATED") {
      return privateJson({ error: "O upload chegou incompleto. Tente novamente." }, { status: 400 });
    }
    if (error instanceof AdminJsonFileError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    return privateJson({ error: "Não foi possível ler o arquivo enviado." }, { status: 400 });
  }
}

export const POST = withApiLogging("/api/admin/json", uploadJson);

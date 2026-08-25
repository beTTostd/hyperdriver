import { getCurrentUser } from "../../../../lib/auth";
import { privateJson, withApiLogging } from "../../../../lib/http";
import {
  getUploadHealthSummary,
  listUploadEventDetails,
  safeUploadEventCategory,
  type UploadEventCategory,
} from "../../../../lib/upload-telemetry";

export const runtime = "nodejs";

async function getUploadHealth(request: Request) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ error: "Autenticação necessária." }, { status: 401 });
  if (user.role !== "admin") return privateJson({ error: "Acesso administrativo necessário." }, { status: 403 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const category = safeUploadEventCategory(url.searchParams.get("category"));
  const pageValue = Number(url.searchParams.get("page") || "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;

  try {
    const summary = getUploadHealthSummary();
    const details = date && category
      ? listUploadEventDetails(date, category as UploadEventCategory, page)
      : null;
    return privateJson({ summary, details });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", type: "admin_upload_health_failed", userId: user.id, message: (error as Error).message }));
    return privateJson({ error: "Não foi possível carregar a saúde do sistema." }, { status: 500 });
  }
}

export const GET = withApiLogging("/api/admin/upload-health", getUploadHealth);

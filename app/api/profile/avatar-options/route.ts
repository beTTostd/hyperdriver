import { getCurrentUser } from "../../../../lib/auth";
import {
  buildCatalogAvatarOptions,
  type CatalogCard,
} from "../../../../lib/card-avatar-catalog";
import {
  privateJson,
  rateLimitIdentity,
  rateLimitedResponse,
  withApiLogging,
} from "../../../../lib/http";
import { consumeRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

const CARD_API_URL = process.env.CARD_CATALOG_API_URL || "https://api.goagain.dev/v1/cards";
const PAGE_SIZE = 100;
const CACHE_SECONDS = 24 * 60 * 60;

type CatalogResponse = {
  data?: unknown;
  meta?: {
    total?: unknown;
  };
};

async function avatarOptions(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return privateJson({ error: "Você precisa estar autenticado." }, { status: 401 });
  }
  const limit = consumeRateLimit(
    "card-catalog-user",
    rateLimitIdentity(String(currentUser.id)),
    30,
    60 * 1000,
  );
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);

  const name = new URL(request.url).searchParams.get("name")?.trim() || "";
  if (name.length < 2 || name.length > 80) {
    return privateJson(
      { error: "Busque por um nome entre 2 e 80 caracteres." },
      { status: 400 },
    );
  }

  try {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      name,
      offset: "0",
    });
    const catalogUrl = new URL(CARD_API_URL);
    if (
      catalogUrl.protocol !== "https:" &&
      catalogUrl.hostname !== "127.0.0.1" &&
      catalogUrl.hostname !== "localhost"
    ) throw new Error("Card catalog must use HTTPS.");
    catalogUrl.search = params.toString();
    const response = await fetch(catalogUrl, {
      headers: { accept: "application/json" },
      cache: "force-cache",
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Card catalog returned ${response.status}`);

    const payload = await response.json() as CatalogResponse;
    const cards = Array.isArray(payload.data) ? payload.data as CatalogCard[] : [];
    const total = typeof payload.meta?.total === "number" ? payload.meta.total : null;

    return privateJson({
      options: buildCatalogAvatarOptions(cards),
      hasMore: total === null ? cards.length === PAGE_SIZE : total > cards.length,
    });
  } catch {
    return privateJson(
      { error: "Não foi possível carregar o catálogo de cartas." },
      { status: 502 },
    );
  }
}

export const GET = withApiLogging("/api/profile/avatar-options", avatarOptions);

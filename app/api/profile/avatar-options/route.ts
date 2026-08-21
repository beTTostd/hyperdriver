import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import {
  buildCatalogAvatarOptions,
  type CatalogCard,
} from "../../../../lib/card-avatar-catalog";

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

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Você precisa estar autenticado." }, { status: 401 });
  }

  const name = new URL(request.url).searchParams.get("name")?.trim() || "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
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
    const response = await fetch(`${CARD_API_URL}?${params}`, {
      headers: { accept: "application/json" },
      cache: "force-cache",
      next: { revalidate: CACHE_SECONDS },
    });
    if (!response.ok) throw new Error(`Card catalog returned ${response.status}`);

    const payload = await response.json() as CatalogResponse;
    const cards = Array.isArray(payload.data) ? payload.data as CatalogCard[] : [];
    const total = typeof payload.meta?.total === "number" ? payload.meta.total : null;

    return NextResponse.json({
      options: buildCatalogAvatarOptions(cards),
      hasMore: total === null ? cards.length === PAGE_SIZE : total > cards.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar o catálogo de cartas." },
      { status: 502 },
    );
  }
}

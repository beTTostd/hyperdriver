import { NextResponse } from "next/server";
import {
  CARD_AVATAR_OPTIONS,
  cardAvatarIdFromCatalog,
  type CardAvatarOption,
} from "../../../../lib/card-avatars";

export const runtime = "nodejs";

const CARD_API_URL = "https://api.goagain.dev/v1/cards";
const PAGE_SIZE = 100;

type CatalogCard = {
  name?: unknown;
  color?: unknown;
};

type CatalogResponse = {
  data?: CatalogCard[];
  meta?: {
    total?: number;
  };
};

type BuiltAvatarOption = CardAvatarOption & {
  colorRank: number;
};

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim() || "";

  try {
    const firstPage = await fetchPage(0, name);

    if (name) {
      const options = buildOptions([firstPage], false);
      return NextResponse.json({ options, total: options.length });
    }

    const total = Math.max(firstPage.meta?.total || firstPage.data.length, firstPage.data.length);
    const offsets = Array.from(
      { length: Math.ceil(total / PAGE_SIZE) - 1 },
      (_, index) => (index + 1) * PAGE_SIZE,
    );
    const pages = await Promise.all(offsets.map((offset) => fetchPage(offset)));
    const options = buildOptions([firstPage, ...pages]);

    return NextResponse.json({ options, total: options.length });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar o catálogo de cartas." },
      { status: 502 },
    );
  }
}

async function fetchPage(offset: number, name = ""): Promise<CatalogResponse & { data: CatalogCard[] }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (name) params.set("name", name);

  const response = await fetch(`${CARD_API_URL}?${params}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`Card catalog returned ${response.status}`);

  const payload = await response.json() as CatalogResponse;
  return { ...payload, data: Array.isArray(payload.data) ? payload.data : [] };
}

function buildOptions(pages: CatalogResponse[], includeFallbacks = true): CardAvatarOption[] {
  const options = new Map<string, BuiltAvatarOption>();

  for (const card of pages.flatMap((page) => page.data || [])) {
    if (typeof card.name !== "string") continue;
    const color = typeof card.color === "string" ? card.color.trim() : "";
    const groupId = cardAvatarIdFromCatalog(card.name);
    const id = cardAvatarIdFromCatalog(card.name, color);
    if (!groupId || !id) continue;
    const colorRank = avatarColorRank(color);
    const current = options.get(groupId);
    if (current && current.colorRank <= colorRank) continue;

    options.set(groupId, { id, label: card.name, colorRank });
  }

  if (includeFallbacks) {
    for (const fallback of CARD_AVATAR_OPTIONS) {
      const groupId = fallback.id.replace(/_(red|yellow|blue)$/, "");
      const color = fallback.id.match(/_(red|yellow|blue)$/)?.[1] || "";
      if (!options.has(groupId)) options.set(groupId, { ...fallback, colorRank: avatarColorRank(color) });
    }
  }

  return [...options.values()].map(({ id, label }) => ({ id, label })).sort((a, b) => {
    if (a.id === "dash_io") return -1;
    if (b.id === "dash_io") return 1;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  });
}

function avatarColorRank(color: string): number {
  return { red: 0, yellow: 1, blue: 2 }[color.toLowerCase()] ?? 3;
}

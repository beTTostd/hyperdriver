import {
  cardAvatarIdFromCatalog,
  type CardAvatarOption,
} from "./card-avatars";

export type CatalogCard = {
  name?: unknown;
  color?: unknown;
};

type RankedAvatarOption = CardAvatarOption & {
  colorRank: number;
};

export function buildCatalogAvatarOptions(cards: CatalogCard[]): CardAvatarOption[] {
  const options = new Map<string, RankedAvatarOption>();

  for (const card of cards) {
    if (typeof card.name !== "string") continue;
    const label = card.name.trim();
    const color = typeof card.color === "string" ? card.color.trim().toLowerCase() : "";
    const groupId = cardAvatarIdFromCatalog(label);
    const id = cardAvatarIdFromCatalog(label, color);
    if (!label || !groupId || !id) continue;

    const candidate = { id, label, colorRank: avatarColorRank(color) };
    const current = options.get(groupId);
    if (!current || candidate.colorRank < current.colorRank) options.set(groupId, candidate);
  }

  return [...options.values()]
    .map(({ id, label }) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

export function avatarColorRank(color: string): number {
  const ranks: Record<string, number> = { red: 0, yellow: 1, blue: 2 };
  return ranks[color.toLowerCase()] ?? 3;
}

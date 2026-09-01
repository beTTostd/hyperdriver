export const CARD_IMAGE_BASE_URL = "https://images.talishar.net/public/cardimages/english";
export const CARD_ART_BASE_URL = "https://images.talishar.net/public/crops";
export const DEFAULT_CARD_AVATAR = "dash_io";
export const MAX_CARD_AVATAR_ID_LENGTH = 128;

export type CardAvatarOption = {
  id: string;
  label: string;
};

export const CARD_AVATAR_OPTIONS = [
  { id: "dash_io", label: "Dash I/O" },
  { id: "crown_of_providence", label: "Crown of Providence" },
  { id: "goliath_gauntlet", label: "Goliath Gauntlet" },
  { id: "achilles_accelerator", label: "Achilles Accelerator" },
  { id: "teklo_core_blue", label: "Teklo Core" },
  { id: "teklo_foundry_heart", label: "Teklo Foundry Heart" },
  { id: "cerebellum_processor_blue", label: "Cerebellum Processor" },
  { id: "spark_of_genius_yellow", label: "Spark of Genius" },
  { id: "null_time_zone_blue", label: "Null Time Zone" },
  { id: "hyper_scrapper_blue", label: "Hyper Scrapper" },
  { id: "boom_grenade_red", label: "Boom Grenade" },
  { id: "zero_to_sixty_red", label: "Zero to Sixty" },
] as const;

export function cardAvatarIdFromCatalog(name: string, color?: string | null): string {
  const normalizedName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[\/]/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const normalizedColor = color?.trim().toLowerCase();

  return [normalizedName, normalizedColor && /^(red|yellow|blue)$/.test(normalizedColor) ? normalizedColor : ""]
    .filter(Boolean)
    .join("_");
}

export function cardImageUrl(cardId: string): string {
  return `${CARD_IMAGE_BASE_URL}/${encodeURIComponent(cardId)}.webp`;
}

export function cardArtImageUrl(cardId: string): string {
  return `${CARD_ART_BASE_URL}/${encodeURIComponent(cardId)}_cropped.webp`;
}

export function normalizeCardAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cardId = value.trim().toLowerCase();
  return cardId || null;
}

export function isValidCardAvatar(cardId: string | null): cardId is string {
  return typeof cardId === "string"
    && cardId.length <= MAX_CARD_AVATAR_ID_LENGTH
    && /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(cardId);
}

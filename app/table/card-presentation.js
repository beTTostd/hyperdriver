const CARD_IMAGE_ROOT = "https://images.talishar.net/public";

const MARKER_DETAILS = {
  defense: { label: "Defesa", abbreviation: "DEF", kind: "defense" },
  steam: { label: "Steam", abbreviation: "STM", kind: "steam" },
  attack: { label: "Ataque", abbreviation: "ATK", kind: "attack" },
  life: { label: "Vida", abbreviation: "VID", kind: "life" },
  energy: { label: "Energia", abbreviation: "ENE", kind: "energy" },
  frost: { label: "Frost", abbreviation: "FRS", kind: "frost" },
  aim: { label: "Aim", abbreviation: "AIM", kind: "aim" },
  counters: { label: "Contadores", abbreviation: "CTR", kind: "generic" },
};

const MARKER_PRIORITY = new Map([
  "defense",
  "steam",
  "attack",
  "life",
  "energy",
  "frost",
  "aim",
].map((key, index) => [key, index]));

function readableCounterName(key) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function counterAbbreviation(key) {
  const words = readableCounterName(key).split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return words[0]?.slice(0, 3).toUpperCase() || "CTR";
}

export function squareCardImageUrl(cardNumber) {
  return `${CARD_IMAGE_ROOT}/cardsquares/english/${encodeURIComponent(cardNumber)}.webp`;
}

export function fullCardImageUrl(cardNumber) {
  return `${CARD_IMAGE_ROOT}/cardimages/english/${encodeURIComponent(cardNumber)}.webp`;
}

export function cardMarkers(card) {
  const entries = Object.entries(card?.countersMap ?? {})
    .map(([key, rawValue]) => [key, Number(rawValue)])
    .filter(([, value]) => Number.isFinite(value) && value !== 0);

  if (!entries.length) {
    const fallback = Number(card?.counters);
    if (Number.isFinite(fallback) && fallback !== 0) entries.push(["counters", fallback]);
  }

  return entries
    .sort(([left], [right]) => {
      const leftPriority = MARKER_PRIORITY.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = MARKER_PRIORITY.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left.localeCompare(right);
    })
    .map(([key, value]) => {
      const details = MARKER_DETAILS[key] ?? {
        label: readableCounterName(key),
        abbreviation: counterAbbreviation(key),
        kind: "generic",
      };
      return { key, value, ...details };
    });
}

export function markerSummary(markers) {
  return markers.map((marker) => `${marker.label}: ${marker.value}`).join(", ");
}

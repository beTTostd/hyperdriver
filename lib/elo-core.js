export const ELO_INITIAL_RATING = 1000;
export const ELO_K_FACTOR = 32;
export const ELO_EXPECTATION_DIVISOR = 400;

export function normalizeTalisharNick(value) {
  if (typeof value !== "string") return null;
  const displayName = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!displayName || displayName.length > 160) return null;
  return {
    displayName,
    normalizedName: displayName.toLowerCase(),
  };
}

export function calculateEloChange(
  winnerRating,
  loserRating,
  kFactor = ELO_K_FACTOR,
) {
  const expectedWinner = 1 / (
    1 + (10 ** ((loserRating - winnerRating) / ELO_EXPECTATION_DIVISOR))
  );
  const change = kFactor * (1 - expectedWinner);
  return {
    change,
    expectedWinner,
    winnerRating: winnerRating + change,
    loserRating: loserRating - change,
  };
}

export function extractEloCandidate(document, result) {
  const frames = Array.isArray(document?.match?.frames) ? document.match.frames : [];
  const initialLoad = frames
    .map((frame) => frame?.payload?.initialLoad)
    .find((value) => value && typeof value === "object" && !Array.isArray(value));
  const formatValue = document?.match?.gameFormat ?? initialLoad?.gameFormat;
  const format = typeof formatValue === "string"
    ? formatValue.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase()
    : "";
  const gameGuid = typeof initialLoad?.gameGUID === "string"
    ? initialLoad.gameGUID.normalize("NFKC").trim()
    : typeof initialLoad?.gameGUID === "number"
      ? String(initialLoad.gameGUID)
      : "";
  const player = normalizeTalisharNick(initialLoad?.playerName);
  const opponent = normalizeTalisharNick(initialLoad?.opponentName);

  if (!gameGuid || gameGuid.length > 128 || !/^[\p{L}\p{N}._:-]+$/u.test(gameGuid)) {
    return { eligible: false, reason: "GUID ausente ou inválido.", gameGuid: null };
  }
  if (!isExplicitHuman(initialLoad?.isOpponentAI)) {
    return { eligible: false, reason: "Partida contra IA ou sem identificação PvP.", gameGuid };
  }
  if (!player || !opponent || player.normalizedName === opponent.normalizedName) {
    return { eligible: false, reason: "Nicks Talishar ausentes ou inválidos.", gameGuid };
  }
  if (!format || format.length > 80) {
    return { eligible: false, reason: "Formato ausente ou inválido.", gameGuid };
  }
  if (result !== "victory" && result !== "defeat") {
    return { eligible: false, reason: "Vencedor não determinável.", gameGuid };
  }

  return {
    eligible: true,
    gameGuid,
    format,
    player,
    opponent,
    winner: result === "victory" ? player : opponent,
    loser: result === "victory" ? opponent : player,
  };
}

function isExplicitHuman(value) {
  if (value === false || value === 0) return true;
  if (typeof value !== "string") return false;
  return ["false", "0", "no"].includes(value.trim().toLowerCase());
}

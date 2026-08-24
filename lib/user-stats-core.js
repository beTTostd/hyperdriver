const DAY_MS = 24 * 60 * 60 * 1000;

export const USER_STATS_PERIODS = Object.freeze(["7", "30", "90", "365", "all"]);

const TELEMETRY_KEYS = Object.freeze([
  "receivedDamage",
  "equipmentBlocked",
  "cardBlocked",
  "offeredDamage",
  "lifeGained",
]);

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = numberOrNull(value);
  return number === null ? 0 : Math.max(0, number);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function resultStats(result) {
  return {
    wins: result === "victory" ? 1 : 0,
    losses: result === "defeat" ? 1 : 0,
  };
}

function winRate(wins, losses) {
  const decisiveMatches = wins + losses;
  return decisiveMatches ? round((wins / decisiveMatches) * 100) : 0;
}

function normalizedMode(value) {
  if (typeof value !== "string") return null;
  const mode = value.trim().toLowerCase();
  return mode || null;
}

export function normalizeStatsPeriod(value) {
  const period = String(value ?? "30").trim().toLowerCase();
  return USER_STATS_PERIODS.includes(period) ? period : "30";
}

export function normalizeStatsMode(value) {
  const mode = normalizedMode(value);
  return !mode || mode === "all" || mode === "todos" ? "all" : mode;
}

function utcWeekStart(timestamp) {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

function ownedRecords(records, userId) {
  return records.filter((record) => {
    const ownerId = numberOrNull(record?.userId ?? record?.metadata?.userId);
    return ownerId !== null && ownerId === userId && record?.metadata;
  });
}

function metadataTime(metadata) {
  return numberOrNull(metadata?.startedAt);
}

function ordered(records) {
  return [...records].sort((left, right) => {
    const timeDifference = (metadataTime(right.metadata) ?? 0) - (metadataTime(left.metadata) ?? 0);
    if (timeDifference) return timeDifference;
    return (numberOrNull(right.metadata.uploadedAt) ?? 0) - (numberOrNull(left.metadata.uploadedAt) ?? 0);
  });
}

function aggregateBucket(bucket) {
  return {
    matches: bucket.matches,
    wins: bucket.wins,
    losses: bucket.losses,
    winRate: winRate(bucket.wins, bucket.losses),
  };
}

function emptyTelemetryValues() {
  return Object.fromEntries(TELEMETRY_KEYS.map((key) => [key, 0]));
}

function telemetrySummary(records, calculateTelemetry) {
  const totals = emptyTelemetryValues();
  let validReplayCount = 0;

  if (typeof calculateTelemetry === "function") {
    for (const record of records) {
      if (!record.document) continue;
      let cycles;
      try {
        cycles = calculateTelemetry(record.document);
      } catch {
        continue;
      }
      if (!Array.isArray(cycles) || cycles.length === 0) continue;

      validReplayCount += 1;
      for (const cycle of cycles) {
        for (const key of TELEMETRY_KEYS) totals[key] += positiveNumber(cycle?.[key]);
      }
    }
  }

  for (const record of records) {
    if (!record.metrics || positiveNumber(record.metrics.cycleCount) === 0) continue;
    validReplayCount += 1;
    for (const key of TELEMETRY_KEYS) totals[key] += positiveNumber(record.metrics[key]);
  }

  const averages = Object.fromEntries(
    TELEMETRY_KEYS.map((key) => [key, validReplayCount ? round(totals[key] / validReplayCount) : 0]),
  );

  return { totals, averages, validReplayCount };
}

export function aggregateUserStats(records, options = {}) {
  const userId = numberOrNull(options.userId);
  const now = numberOrNull(options.now) ?? Date.now();
  const period = normalizeStatsPeriod(options.period);
  const mode = normalizeStatsMode(options.mode);
  const allOwned = userId === null ? [] : ownedRecords(records, userId);
  const availableModes = [...new Set(allOwned.map((record) => normalizedMode(record.metadata.gameMode)).filter(Boolean))].sort();
  const periodStart = period === "all" ? null : now - Number(period) * DAY_MS;

  const filtered = ordered(allOwned).filter((record) => {
    const startedAt = metadataTime(record.metadata);
    if (startedAt === null || startedAt > now || (periodStart !== null && startedAt < periodStart)) return false;
    const recordMode = normalizedMode(record.metadata.gameMode);
    return mode === "all" || recordMode === mode;
  });

  const summaryBucket = { matches: filtered.length, wins: 0, losses: 0 };
  let turnTotal = 0;
  let turnCount = 0;
  const evolutionBuckets = new Map();
  const heroBuckets = new Map();
  const matchupBuckets = new Map();

  for (const record of filtered) {
    const metadata = record.metadata;
    const result = resultStats(metadata.result);
    summaryBucket.wins += result.wins;
    summaryBucket.losses += result.losses;

    const finalTurn = numberOrNull(metadata.finalTurn);
    if (finalTurn !== null) {
      turnTotal += finalTurn;
      turnCount += 1;
    }

    const startedAt = metadataTime(metadata);
    if (startedAt !== null) {
      const weekStart = utcWeekStart(startedAt);
      const bucket = evolutionBuckets.get(weekStart) ?? { matches: 0, wins: 0, losses: 0 };
      bucket.matches += 1;
      bucket.wins += result.wins;
      bucket.losses += result.losses;
      evolutionBuckets.set(weekStart, bucket);
    }

    const playerHero = typeof metadata.playerHeroId === "string" && metadata.playerHeroId.trim()
      ? metadata.playerHeroId.trim()
      : null;
    if (playerHero) {
      const bucket = heroBuckets.get(playerHero) ?? { matches: 0, wins: 0, losses: 0 };
      bucket.matches += 1;
      bucket.wins += result.wins;
      bucket.losses += result.losses;
      heroBuckets.set(playerHero, bucket);
    }

    const opponentHero = typeof metadata.opponentHeroId === "string" && metadata.opponentHeroId.trim()
      ? metadata.opponentHeroId.trim()
      : null;
    if (opponentHero) {
      const bucket = matchupBuckets.get(opponentHero) ?? { matches: 0, wins: 0, losses: 0 };
      bucket.matches += 1;
      bucket.wins += result.wins;
      bucket.losses += result.losses;
      matchupBuckets.set(opponentHero, bucket);
    }
  }

  const heroes = [...heroBuckets.entries()]
    .map(([heroId, bucket]) => ({
      hero: heroId,
      heroId,
      ...aggregateBucket(bucket),
      participation: summaryBucket.matches ? round((bucket.matches / summaryBucket.matches) * 100) : 0,
    }))
    .sort((left, right) => right.matches - left.matches || right.winRate - left.winRate || left.hero.localeCompare(right.hero));

  const matchups = [...matchupBuckets.entries()]
    .filter(([, bucket]) => bucket.matches >= 2)
    .map(([opponentHeroId, bucket]) => ({
      opponent: opponentHeroId,
      opponentHeroId,
      ...aggregateBucket(bucket),
    }))
    .sort((left, right) => right.matches - left.matches || right.winRate - left.winRate || left.opponent.localeCompare(right.opponent));

  const evolution = [...evolutionBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, bucket]) => ({ weekStart, ...aggregateBucket(bucket) }));

  const summary = {
    matches: summaryBucket.matches,
    wins: summaryBucket.wins,
    losses: summaryBucket.losses,
    winRate: winRate(summaryBucket.wins, summaryBucket.losses),
    averageTurns: turnCount ? round(turnTotal / turnCount) : 0,
  };

  return {
    summary,
    evolution,
    heroes,
    matchups,
    telemetry: telemetrySummary(filtered, options.calculateTelemetry),
    recentMatches: ordered(filtered).slice(0, 5).map(({ metadata }) => ({
      id: metadata.id,
      sourceMatchId: metadata.sourceMatchId,
      result: metadata.result,
      gameMode: normalizedMode(metadata.gameMode),
      playerHeroId: typeof metadata.playerHeroId === "string" && metadata.playerHeroId.trim() ? metadata.playerHeroId.trim() : null,
      opponentHeroId: typeof metadata.opponentHeroId === "string" && metadata.opponentHeroId.trim() ? metadata.opponentHeroId.trim() : null,
      startedAt: metadata.startedAt,
      finalTurn: numberOrNull(metadata.finalTurn),
    })),
    filters: {
      period,
      mode,
      startAt: periodStart,
      endAt: now,
    },
    availableModes,
  };
}

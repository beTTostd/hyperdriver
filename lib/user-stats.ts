import { listUserReplayStats, type ReplayMetricTotals, type ReplayMetadata } from "./replays";
import { aggregateDecisionAnalysis, type DecisionAnalysisAggregate } from "./decision-analysis";
import {
  aggregateUserStats,
  normalizeStatsMode,
  normalizeStatsPeriod,
  USER_STATS_PERIODS,
} from "./user-stats-core.js";

export { normalizeStatsMode, normalizeStatsPeriod, USER_STATS_PERIODS };

export type UserStatsPeriod = "7" | "30" | "90" | "365" | "all";

export type UserStatsFilters = {
  period?: string | null;
  mode?: string | null;
};

export type UserStatsRecord = {
  userId: number;
  metadata: ReplayMetadata;
  metrics: ReplayMetricTotals | null;
};

export type UserStats = ReturnType<typeof aggregateUserStats> & {
  decisionAnalysis: DecisionAnalysisAggregate;
};

export async function getUserStats(userId: number, filters: UserStatsFilters = {}): Promise<UserStats> {
  const records: UserStatsRecord[] = listUserReplayStats(userId).map(({ metrics, ...metadata }) => ({
    userId,
    metadata,
    metrics,
  }));

  const base = aggregateUserStats(records, {
    userId,
    period: normalizeStatsPeriod(filters.period),
    mode: normalizeStatsMode(filters.mode),
  });
  return {
    ...base,
    decisionAnalysis: aggregateDecisionAnalysis(userId, {
      startAt: base.filters.startAt,
      endAt: base.filters.endAt,
      mode: base.filters.mode,
    }),
  } as UserStats;
}

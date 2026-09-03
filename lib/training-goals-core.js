export function automaticGoalResult({ baselineRate, currentRate, progressMatches, targetMatches }) {
  if (!Number.isFinite(baselineRate) || baselineRate <= 0 || !Number.isFinite(currentRate)) {
    return { complete: progressMatches >= targetMatches, achieved: false, reduction: 0 };
  }
  const reduction = (baselineRate - currentRate) / baselineRate;
  const complete = progressMatches >= targetMatches;
  return { complete, achieved: complete && reduction >= 0.25, reduction };
}

export const contextRolloverPercent = 75;

export interface TokenUsageWire {
  last?: {
    totalTokens?: unknown;
    inputTokens?: unknown;
  };
  modelContextWindow?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function contextUsagePercent(tokenUsage: TokenUsageWire): number | null {
  const window = finiteNumber(tokenUsage.modelContextWindow);
  const lastTotal = finiteNumber(tokenUsage.last?.totalTokens);
  const lastInput = finiteNumber(tokenUsage.last?.inputTokens);
  const used = lastTotal ?? lastInput;

  if (window === null || window <= 0 || used === null || used < 0) {
    return null;
  }

  return (used / window) * 100;
}

export function shouldRolloverContext(percent: number | null): boolean {
  return percent !== null && percent >= contextRolloverPercent;
}

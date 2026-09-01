import type {
  QuotaWindow,
  RateLimitSnapshotWire,
  RateLimitsResponseWire,
} from "./types.js";

export const reservePercent = 10;
export const usedPercentLimit = 100 - reservePercent;
export const resetGraceMs = 30_000;
export const retryBackoffMs = [
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
] as const;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function quotaWindowLabel(durationMins: number | null): string {
  if (durationMins === 300) {
    return "5 hours";
  }

  if (durationMins === 10_080) {
    return "weekly";
  }

  return durationMins === null ? "unknown" : `${durationMins} minutes`;
}

function snapshotWindows(
  snapshot: RateLimitSnapshotWire,
  fallbackBucketId: string,
): QuotaWindow[] {
  const bucketId =
    typeof snapshot.limitId === "string" && snapshot.limitId.length > 0
      ? snapshot.limitId
      : fallbackBucketId;
  const bucketName =
    typeof snapshot.limitName === "string" ? snapshot.limitName : null;
  const result: QuotaWindow[] = [];

  for (const slot of ["primary", "secondary"] as const) {
    const raw = snapshot[slot];
    if (!raw) {
      continue;
    }

    const usedPercent = finiteNumber(raw.usedPercent);
    if (usedPercent === null) {
      continue;
    }

    const windowDurationMins = finiteNumber(raw.windowDurationMins);
    const resetsAt = finiteNumber(raw.resetsAt);
    result.push({
      bucketId,
      bucketName,
      slot,
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      windowDurationMins,
      resetsAt,
      label: quotaWindowLabel(windowDurationMins),
    });
  }

  return result;
}

export function extractQuotaWindows(
  response: RateLimitsResponseWire,
): QuotaWindow[] {
  const buckets = response.rateLimitsByLimitId;
  if (buckets && Object.keys(buckets).length > 0) {
    return Object.entries(buckets).flatMap(([bucketId, snapshot]) =>
      snapshot ? snapshotWindows(snapshot, bucketId) : [],
    );
  }

  return response.rateLimits
    ? snapshotWindows(response.rateLimits, "default")
    : [];
}

export function extractNotificationWindows(params: unknown): QuotaWindow[] {
  if (!params || typeof params !== "object") {
    return [];
  }

  const rateLimits = (params as { rateLimits?: RateLimitSnapshotWire }).rateLimits;
  return rateLimits ? snapshotWindows(rateLimits, "default") : [];
}

export function blockingQuotaWindows(windows: QuotaWindow[]): QuotaWindow[] {
  return windows.filter((window) => window.usedPercent >= usedPercentLimit);
}

export function nextQuotaCheckAt(
  blocked: QuotaWindow[],
  now: number,
  backoffStep: number,
): number {
  const fallback = now + retryBackoffMs[Math.min(backoffStep, retryBackoffMs.length - 1)];
  if (
    blocked.length === 0 ||
    blocked.some((window) => window.resetsAt === null)
  ) {
    return fallback;
  }

  const resetTimes = blocked.map((window) => (window.resetsAt as number) * 1_000);
  return Math.max(now, ...resetTimes) + resetGraceMs;
}

export class QuotaTurnGuard {
  private interruptRequested = false;

  constructor(private readonly interrupt: () => Promise<void>) {}

  async observe(windows: QuotaWindow[]): Promise<boolean> {
    if (this.interruptRequested || blockingQuotaWindows(windows).length === 0) {
      return false;
    }

    this.interruptRequested = true;
    await this.interrupt();
    return true;
  }
}

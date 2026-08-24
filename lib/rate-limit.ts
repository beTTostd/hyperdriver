import { randomUUID } from "node:crypto";
import { and, count, eq, gt, lte, min } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimitEvents, uploadLeases } from "../db/schema";

type RateLimitResult = { allowed: boolean; retryAfter: number };

export function checkRateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  maybeCleanup(now);
  const database = getDb();
  const since = now - windowMs;
  const current = database
    .select({ value: count(), oldest: min(rateLimitEvents.occurredAt) })
    .from(rateLimitEvents)
    .where(and(
      eq(rateLimitEvents.bucket, bucket),
      eq(rateLimitEvents.identity, identity),
      gt(rateLimitEvents.occurredAt, since),
    ))
    .get();
  const used = current?.value ?? 0;
  const oldest = current?.oldest ?? now;
  return used >= limit
    ? { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
    : { allowed: true, retryAfter: 0 };
}

export function recordRateLimit(bucket: string, identity: string, now = Date.now()): void {
  getDb().insert(rateLimitEvents).values({ bucket, identity, occurredAt: now }).run();
}

export function consumeRateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const result = checkRateLimit(bucket, identity, limit, windowMs, now);
  if (result.allowed) recordRateLimit(bucket, identity, now);
  return result;
}

export function acquireUploadLease(userId: number, maxConcurrent = 2): string | null {
  const database = getDb();
  const now = Date.now();
  const id = randomUUID();
  return database.transaction((transaction) => {
    transaction.delete(uploadLeases).where(lte(uploadLeases.expiresAt, now)).run();
    const active = transaction
      .select({ value: count() })
      .from(uploadLeases)
      .where(and(eq(uploadLeases.userId, userId), gt(uploadLeases.expiresAt, now)))
      .get()?.value ?? 0;
    if (active >= maxConcurrent) return null;
    transaction.insert(uploadLeases).values({ id, userId, expiresAt: now + 5 * 60 * 1000 }).run();
    return id;
  });
}

export function releaseUploadLease(id: string): void {
  getDb().delete(uploadLeases).where(eq(uploadLeases.id, id)).run();
}

let lastCleanup = 0;
function maybeCleanup(now: number) {
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  getDb().delete(rateLimitEvents).where(lte(rateLimitEvents.occurredAt, now - 24 * 60 * 60 * 1000)).run();
  getDb().delete(uploadLeases).where(lte(uploadLeases.expiresAt, now)).run();
}

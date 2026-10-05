import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb, getSqlite } from "../db";
import { analysisJobs, replayAnalyses } from "../db/schema";
import { CURRENT_DECISION_MODEL_ID, processReplayAnalysis } from "./decision-analysis";
import { recoverOutdatedAnalyses } from "./analysis-recovery.js";

const LEASE_MS = 5 * 60 * 1000;
const POLL_MS = 5_000;
const MAX_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 240;

type ClaimedJob = {
  replayId: number;
  attempts: number;
  leaseToken: string;
};

export type AnalysisQueueSummary = {
  pending: number;
  running: number;
  ready: number;
  failed: number;
  abandoned: number;
};

function sanitizeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Falha desconhecida na análise.";
  return message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_LENGTH) || "Falha desconhecida na análise.";
}

export function enqueueAnalysisJob(replayId: number, now = Date.now()): void {
  const database = getDb();
  database.transaction((transaction) => {
    transaction
      .insert(replayAnalyses)
      .values({ replayId, status: "pending", queuedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: replayAnalyses.replayId,
        set: { status: "pending", errorCode: null, queuedAt: now, updatedAt: now },
      })
      .run();
    transaction
      .insert(analysisJobs)
      .values({ replayId, status: "pending", availableAt: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: analysisJobs.replayId,
        set: {
          status: "pending",
          attempts: 0,
          availableAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
          completedAt: null,
        },
      })
      .run();
  });
}

function claimNextJob(now = Date.now()): ClaimedJob | null {
  const leaseToken = randomUUID();
  const row = getSqlite().prepare(`
    UPDATE analysis_jobs
    SET status = 'running',
        attempts = attempts + 1,
        lease_token = ?,
        lease_expires_at = ?,
        updated_at = ?
    WHERE replay_id = (
      SELECT replay_id
      FROM analysis_jobs
      WHERE (status = 'pending' AND available_at <= ?)
         OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
      ORDER BY available_at, replay_id
      LIMIT 1
    )
    AND ((status = 'pending' AND available_at <= ?)
      OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?))
    RETURNING replay_id AS replayId, attempts
  `).get(leaseToken, now + LEASE_MS, now, now, now, now, now) as { replayId: number; attempts: number } | undefined;
  return row ? { ...row, leaseToken } : null;
}

function completeJob(job: ClaimedJob, now = Date.now()): void {
  getDb()
    .update(analysisJobs)
    .set({
      status: "ready",
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: now,
      completedAt: now,
    })
    .where(and(eq(analysisJobs.replayId, job.replayId), eq(analysisJobs.leaseToken, job.leaseToken)))
    .run();
}

function failJob(job: ClaimedJob, error: unknown, now = Date.now()): void {
  const terminal = job.attempts >= MAX_ATTEMPTS;
  const retryDelay = Math.min(60 * 60 * 1000, 2 ** Math.max(0, job.attempts - 1) * 15_000);
  getDb().transaction((transaction) => {
    const changed = transaction
      .update(analysisJobs)
      .set({
        status: terminal ? "failed" : "pending",
        availableAt: terminal ? now : now + retryDelay,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: sanitizeJobError(error),
        updatedAt: now,
        completedAt: terminal ? now : null,
      })
      .where(and(eq(analysisJobs.replayId, job.replayId), eq(analysisJobs.leaseToken, job.leaseToken)))
      .run().changes;
    if (changed > 0 && !terminal) {
      transaction
        .update(replayAnalyses)
        .set({ status: "pending", queuedAt: now, updatedAt: now })
        .where(eq(replayAnalyses.replayId, job.replayId))
        .run();
    }
  });
}

export async function processNextAnalysisJob(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  const controller = new AbortController();
  const ownsLease = () => Boolean(getDb().select({ id: analysisJobs.replayId }).from(analysisJobs).where(and(
    eq(analysisJobs.replayId, job.replayId), eq(analysisJobs.leaseToken, job.leaseToken), eq(analysisJobs.status, "running"),
    sql`${analysisJobs.leaseExpiresAt} > ${Date.now()}`,
  )).get());
  const heartbeat = setInterval(() => {
    try {
      const now = Date.now();
      const renewed = getDb().update(analysisJobs).set({ leaseExpiresAt: now + LEASE_MS, updatedAt: now }).where(and(
        eq(analysisJobs.replayId, job.replayId), eq(analysisJobs.leaseToken, job.leaseToken), eq(analysisJobs.status, "running"),
        sql`${analysisJobs.leaseExpiresAt} > ${now}`,
      )).run().changes;
      if (!renewed) controller.abort();
    } catch {
      controller.abort();
    }
  }, 30_000);
  heartbeat.unref();
  try {
    await processReplayAnalysis(job.replayId, undefined, { signal: controller.signal, canCommit: ownsLease });
    completeJob(job);
  } catch (error) {
    failJob(job, error);
    console.error(JSON.stringify({
      level: "error",
      type: "replay_analysis_job_failed",
      replayId: job.replayId,
      attempt: job.attempts,
      terminal: job.attempts >= MAX_ATTEMPTS,
    }));
  }
  finally { clearInterval(heartbeat); }
  return true;
}

let workerStarted = false;
let workerBusy = false;

async function drainQueue(): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    for (let processed = 0; processed < 10 && await processNextAnalysisJob(); processed += 1) {
      // Bound each pass so request handling cannot be starved by a large backlog.
    }
  } finally {
    workerBusy = false;
  }
}

export function startAnalysisWorker(): void {
  if (workerStarted || process.env.NEXT_PHASE === "phase-production-build") return;
  const recovered = recoverOutdatedAnalyses(getSqlite(), CURRENT_DECISION_MODEL_ID);
  if (recovered > 0) console.info(JSON.stringify({ type: "analysis_recovery_queued", count: recovered }));
  workerStarted = true;
  const timer = setInterval(() => void drainQueue(), POLL_MS);
  timer.unref();
  setTimeout(() => void drainQueue(), 0).unref();
}

export function getAnalysisQueueSummary(now = Date.now()): AnalysisQueueSummary {
  const rows = getDb()
    .select({ status: analysisJobs.status, total: count() })
    .from(analysisJobs)
    .groupBy(analysisJobs.status)
    .all();
  const totals = Object.fromEntries(rows.map((row) => [row.status, row.total]));
  const abandoned = getDb()
    .select({ total: count() })
    .from(analysisJobs)
    .where(and(
      eq(analysisJobs.status, "running"),
      sql`${analysisJobs.leaseExpiresAt} <= ${now}`,
    ))
    .get()?.total ?? 0;
  return {
    pending: totals.pending ?? 0,
    running: totals.running ?? 0,
    ready: totals.ready ?? 0,
    failed: totals.failed ?? 0,
    abandoned,
  };
}

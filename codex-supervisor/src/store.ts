import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

import type {
  DesiredAction,
  JobCheckpoint,
  JobStatus,
  LogRecord,
  QuotaWindow,
  SupervisorJob,
} from "./types.js";

interface JobRow {
  id: string;
  goal: string;
  cwd: string;
  status: JobStatus;
  desired_action: DesiredAction;
  waiting_reason: string | null;
  thread_id: string | null;
  previous_thread_id: string | null;
  current_turn_id: string | null;
  turn_sequence: number;
  inflight_turn_key: string | null;
  checkpoint_json: string | null;
  blocked_windows_json: string;
  next_resume_at: number | null;
  backoff_step: number;
  context_percent: number | null;
  rollover_pending: number;
  last_error: string | null;
  lease_owner: string | null;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapJob(row: JobRow | undefined): SupervisorJob | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    goal: row.goal,
    cwd: row.cwd,
    status: row.status,
    desiredAction: row.desired_action,
    waitingReason: row.waiting_reason,
    threadId: row.thread_id,
    previousThreadId: row.previous_thread_id,
    currentTurnId: row.current_turn_id,
    turnSequence: row.turn_sequence,
    inflightTurnKey: row.inflight_turn_key,
    checkpoint: parseJson<JobCheckpoint | null>(row.checkpoint_json, null),
    blockedWindows: parseJson<QuotaWindow[]>(row.blocked_windows_json, []),
    nextResumeAt: row.next_resume_at,
    backoffStep: row.backoff_step,
    contextPercent: row.context_percent,
    rolloverPending: row.rollover_pending === 1,
    lastError: row.last_error,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function defaultStateDirectory(): string {
  if (process.env.CODEX_SUPERVISOR_STATE_DIR) {
    return process.env.CODEX_SUPERVISOR_STATE_DIR;
  }

  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "codex-supervisor");
}

export function defaultDatabasePath(): string {
  return join(defaultStateDirectory(), "supervisor.sqlite");
}

export class SupervisorStore {
  private readonly db: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'running', 'pausing', 'waiting', 'resuming',
          'completed', 'cancelled', 'needs_attention'
        )),
        desired_action TEXT CHECK (desired_action IN ('pause', 'resume', 'cancel')),
        waiting_reason TEXT,
        thread_id TEXT,
        previous_thread_id TEXT,
        current_turn_id TEXT,
        turn_sequence INTEGER NOT NULL DEFAULT 0,
        inflight_turn_key TEXT,
        checkpoint_json TEXT,
        blocked_windows_json TEXT NOT NULL DEFAULT '[]',
        next_resume_at INTEGER,
        backoff_step INTEGER NOT NULL DEFAULT 0,
        context_percent REAL,
        rollover_pending INTEGER NOT NULL DEFAULT 0 CHECK (rollover_pending IN (0, 1)),
        last_error TEXT,
        lease_owner TEXT,
        lease_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_active_supervisor_job
      ON jobs ((1))
      WHERE status NOT IN ('completed', 'cancelled');

      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        previous_thread_id TEXT,
        context_percent REAL,
        created_at INTEGER NOT NULL,
        UNIQUE(job_id, thread_id)
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  createJob(id: string, cwd: string, goal: string, threadId?: string): SupervisorJob {
    const now = Date.now();
    const insert = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO jobs (
          id, goal, cwd, status, thread_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'resuming', ?, ?, ?)
      `).run(id, goal, cwd, threadId ?? null, now, now);

      if (threadId) {
        this.db.prepare(`
          INSERT INTO thread_history (
            job_id, thread_id, previous_thread_id, context_percent, created_at
          ) VALUES (?, ?, NULL, NULL, ?)
        `).run(id, threadId, now);
      }
    });

    try {
      insert();
    } catch (error) {
      if (error instanceof Error && error.message.includes("one_active_supervisor_job")) {
        throw new Error("There is already an unfinished supervisor job.");
      }
      throw error;
    }

    return this.getJob(id) as SupervisorJob;
  }

  getJob(id: string): SupervisorJob | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | JobRow
      | undefined;
    return mapJob(row);
  }

  getLatestJob(): SupervisorJob | null {
    const row = this.db.prepare(`
      SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1
    `).get() as JobRow | undefined;
    return mapJob(row);
  }

  getActiveJob(): SupervisorJob | null {
    const row = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status NOT IN ('completed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as JobRow | undefined;
    return mapJob(row);
  }

  requestAction(id: string, action: Exclude<DesiredAction, null>): SupervisorJob {
    const current = this.getJob(id);
    if (!current) {
      throw new Error(`Unknown job: ${id}`);
    }
    if (current.status === "completed" || current.status === "cancelled") {
      throw new Error(`Job ${id} is already ${current.status}.`);
    }

    const now = Date.now();
    if (action === "resume") {
      this.db.prepare(`
        UPDATE jobs
        SET status = 'resuming', desired_action = NULL, waiting_reason = NULL,
            next_resume_at = ?, last_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, now, id);
    } else if (action === "pause") {
      this.db.prepare(`
        UPDATE jobs
        SET status = CASE
              WHEN status IN ('running', 'resuming') THEN 'pausing'
              ELSE 'waiting'
            END,
            desired_action = 'pause', waiting_reason = 'manual',
            next_resume_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, id);
    } else {
      this.db.prepare(`
        UPDATE jobs
        SET status = 'pausing', desired_action = 'cancel', updated_at = ?
        WHERE id = ?
      `).run(now, id);
    }

    return this.getJob(id) as SupervisorJob;
  }

  claimRunnableJob(now: number, owner: string, leaseMs = 30_000): SupervisorJob | null {
    const claim = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM jobs
        WHERE (
          status IN ('running', 'resuming', 'pausing')
          OR (
            status = 'waiting'
            AND desired_action IS NULL
            AND next_resume_at IS NOT NULL
            AND next_resume_at <= ?
          )
        )
        AND (lease_until IS NULL OR lease_until < ? OR lease_owner = ?)
        ORDER BY created_at ASC
        LIMIT 1
      `).get(now, now, owner) as JobRow | undefined;

      if (!row) {
        return null;
      }

      const nextStatus = row.status === "waiting" ? "resuming" : row.status;
      this.db.prepare(`
        UPDATE jobs
        SET status = ?, lease_owner = ?, lease_until = ?, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, owner, now + leaseMs, now, row.id);
      return this.getJob(row.id);
    });

    return claim();
  }

  renewLease(id: string, owner: string, now: number, leaseMs = 30_000): boolean {
    const result = this.db.prepare(`
      UPDATE jobs SET lease_until = ?, updated_at = ?
      WHERE id = ? AND lease_owner = ?
    `).run(now + leaseMs, now, id, owner);
    return result.changes === 1;
  }

  releaseLease(id: string, owner: string): void {
    this.db.prepare(`
      UPDATE jobs SET lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ? AND lease_owner = ?
    `).run(Date.now(), id, owner);
  }

  markRunning(id: string): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'running', desired_action = NULL, waiting_reason = NULL,
          next_resume_at = NULL, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
  }

  markPausing(id: string, reason: string): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'pausing', waiting_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, Date.now(), id);
  }

  saveThread(
    id: string,
    threadId: string,
    previousThreadId: string | null,
    contextPercent: number | null,
  ): void {
    const now = Date.now();
    const save = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE jobs
        SET thread_id = ?, previous_thread_id = ?, current_turn_id = NULL,
            inflight_turn_key = NULL, rollover_pending = 0,
            context_percent = NULL, updated_at = ?
        WHERE id = ?
      `).run(threadId, previousThreadId, now, id);
      this.db.prepare(`
        INSERT OR IGNORE INTO thread_history (
          job_id, thread_id, previous_thread_id, context_percent, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(id, threadId, previousThreadId, contextPercent, now);
    });
    save();
  }

  prepareTurn(id: string): { sequence: number; key: string } {
    const prepare = this.db.transaction(() => {
      const current = this.getJob(id);
      if (!current) {
        throw new Error(`Unknown job: ${id}`);
      }
      if (current.inflightTurnKey) {
        return {
          sequence: current.turnSequence,
          key: current.inflightTurnKey,
        };
      }
      const sequence = current.turnSequence + 1;
      const key = randomUUID();
      this.db.prepare(`
        UPDATE jobs
        SET status = 'running', turn_sequence = ?, inflight_turn_key = ?,
            current_turn_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(sequence, key, Date.now(), id);
      return { sequence, key };
    });
    return prepare();
  }

  setCurrentTurn(id: string, turnId: string): void {
    this.db.prepare(`
      UPDATE jobs SET current_turn_id = ?, updated_at = ? WHERE id = ?
    `).run(turnId, Date.now(), id);
  }

  clearCurrentTurn(id: string): void {
    this.db.prepare(`
      UPDATE jobs
      SET current_turn_id = NULL, inflight_turn_key = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
  }

  updateContext(id: string, percent: number, rolloverPending: boolean): void {
    this.db.prepare(`
      UPDATE jobs
      SET context_percent = ?, rollover_pending = ?, updated_at = ?
      WHERE id = ?
    `).run(percent, rolloverPending ? 1 : 0, Date.now(), id);
  }

  saveCheckpoint(id: string, checkpoint: JobCheckpoint): void {
    const json = JSON.stringify(checkpoint);
    const save = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE jobs SET checkpoint_json = ?, updated_at = ? WHERE id = ?
      `).run(json, Date.now(), id);
      this.db.prepare(`
        INSERT INTO checkpoints (job_id, reason, checkpoint_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, checkpoint.reason, json, checkpoint.recordedAt);
    });
    save();
  }

  waitForQuota(
    id: string,
    blockedWindows: QuotaWindow[],
    nextResumeAt: number,
    backoffStep: number,
  ): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'waiting', desired_action = NULL, waiting_reason = 'quota',
          blocked_windows_json = ?, next_resume_at = ?, backoff_step = ?,
          current_turn_id = NULL, inflight_turn_key = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(blockedWindows),
      nextResumeAt,
      backoffStep,
      Date.now(),
      id,
    );
  }

  waitManually(id: string): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'waiting', desired_action = 'pause', waiting_reason = 'manual',
          next_resume_at = NULL, current_turn_id = NULL,
          inflight_turn_key = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
  }

  markResuming(id: string, reason: string): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'resuming', desired_action = NULL, waiting_reason = ?,
          next_resume_at = ?, current_turn_id = NULL,
          inflight_turn_key = NULL, updated_at = ?
      WHERE id = ?
    `).run(reason, Date.now(), Date.now(), id);
  }

  markRecovering(id: string, reason: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE jobs
      SET status = 'resuming', desired_action = NULL, waiting_reason = ?,
          next_resume_at = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, now, now, id);
  }

  markNeedsAttention(id: string, error: string): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'needs_attention', desired_action = NULL,
          waiting_reason = 'needs_attention', next_resume_at = NULL,
          current_turn_id = NULL, inflight_turn_key = NULL,
          last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(error, Date.now(), id);
  }

  markCompleted(id: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE jobs
      SET status = 'completed', desired_action = NULL, waiting_reason = NULL,
          current_turn_id = NULL, inflight_turn_key = NULL,
          lease_owner = NULL, lease_until = NULL,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  markCancelled(id: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE jobs
      SET status = 'cancelled', desired_action = NULL, waiting_reason = NULL,
          current_turn_id = NULL, inflight_turn_key = NULL,
          lease_owner = NULL, lease_until = NULL,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  log(
    jobId: string | null,
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO logs (job_id, level, message, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      jobId,
      level,
      message,
      details === undefined ? null : JSON.stringify(details),
      now,
    );
    const line = JSON.stringify({ time: new Date(now).toISOString(), level, jobId, message });
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  listLogs(jobId: string | null, afterId = 0, limit = 200): LogRecord[] {
    const rows = (jobId
      ? this.db.prepare(`
          SELECT * FROM logs
          WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT ?
        `).all(jobId, afterId, limit)
      : this.db.prepare(`
          SELECT * FROM logs WHERE id > ? ORDER BY id ASC LIMIT ?
        `).all(afterId, limit)) as Array<{
      id: number;
      job_id: string | null;
      level: string;
      message: string;
      details_json: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      level: row.level,
      message: row.message,
      details: parseJson<unknown>(row.details_json, null),
      createdAt: row.created_at,
    }));
  }
}

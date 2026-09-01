export const jobStatuses = [
  "running",
  "pausing",
  "waiting",
  "resuming",
  "completed",
  "cancelled",
  "needs_attention",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

export type DesiredAction = "pause" | "resume" | "cancel" | null;

export interface SupervisorJob {
  id: string;
  goal: string;
  cwd: string;
  status: JobStatus;
  desiredAction: DesiredAction;
  waitingReason: string | null;
  threadId: string | null;
  previousThreadId: string | null;
  currentTurnId: string | null;
  turnSequence: number;
  inflightTurnKey: string | null;
  checkpoint: JobCheckpoint | null;
  blockedWindows: QuotaWindow[];
  nextResumeAt: number | null;
  backoffStep: number;
  contextPercent: number | null;
  rolloverPending: boolean;
  lastError: string | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface QuotaWindow {
  bucketId: string;
  bucketName: string | null;
  slot: "primary" | "secondary";
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
  label: string;
}

export interface RateLimitWindowWire {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}

export interface RateLimitSnapshotWire {
  limitId?: unknown;
  limitName?: unknown;
  primary?: RateLimitWindowWire | null;
  secondary?: RateLimitWindowWire | null;
}

export interface RateLimitsResponseWire {
  rateLimits?: RateLimitSnapshotWire | null;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshotWire | null> | null;
}

export interface GitCheckpoint {
  commit: string | null;
  status: string;
  changedFiles: string[];
  hasConflicts: boolean;
  diff: string;
  diffTruncated: boolean;
}

export interface SupervisorResult {
  status: "continue" | "completed" | "needs_attention";
  summary: string;
  decisions: string[];
  testsExecuted: string[];
  nextAction: string;
}

export interface JobCheckpoint {
  objective: string;
  reason: string;
  recordedAt: number;
  threadId: string | null;
  previousThreadId: string | null;
  turnId: string | null;
  turnSequence: number;
  lastAction: string | null;
  summary: string;
  decisions: string[];
  testsExecuted: string[];
  nextAction: string;
  git: GitCheckpoint;
}

export interface LogRecord {
  id: number;
  jobId: string | null;
  level: string;
  message: string;
  details: unknown;
  createdAt: number;
}

export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export type AppServerMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

import { randomUUID } from "node:crypto";

import { AppServerClient } from "./app-server-client.js";
import {
  buildCheckpoint,
  describeAction,
  parseSupervisorResult,
} from "./checkpoint.js";
import {
  contextUsagePercent,
  shouldRolloverContext,
  type TokenUsageWire,
} from "./context.js";
import {
  continuationTurnPrompt,
  initialTurnPrompt,
  supervisorOutputSchema,
} from "./protocol.js";
import {
  blockingQuotaWindows,
  extractNotificationWindows,
  extractQuotaWindows,
  nextQuotaCheckAt,
  QuotaTurnGuard,
} from "./rate-limits.js";
import { SupervisorStore } from "./store.js";
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  QuotaWindow,
  RateLimitsResponseWire,
  SupervisorJob,
  SupervisorResult,
} from "./types.js";

interface ThreadResponse {
  thread?: {
    id?: string;
    turns?: TurnRecord[];
  };
}

interface TurnRecord {
  id?: string;
  status?: string;
  items?: unknown[];
  error?: unknown;
}

interface TurnResponse {
  turn?: TurnRecord;
}

interface TurnCompletedParams {
  threadId?: string;
  turn?: {
    id?: string;
    status?: string;
    items?: unknown[];
    error?: unknown;
  };
}

type StopReason =
  | "quota"
  | "context"
  | "manual"
  | "cancel"
  | "attention"
  | "shutdown"
  | null;

type TurnWaitResult =
  | { kind: "completed"; params: TurnCompletedParams }
  | { kind: "exit"; error: Error };

export type TurnFailureKind =
  | "quota"
  | "context"
  | "auth"
  | "transport"
  | "other";

export function classifyTurnFailure(error: unknown): TurnFailureKind {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error);
  if (/UsageLimitExceeded|rate.?limit|usage.?limit/i.test(text)) {
    return "quota";
  }
  if (/ContextWindowExceeded|context window/i.test(text)) {
    return "context";
  }
  if (/Unauthorized|unauthenticated|authentication|login|401/i.test(text)) {
    return "auth";
  }
  if (
    /app-server exited|not connected|EPIPE|ECONNRESET|request timed out/i.test(
      text,
    )
  ) {
    return "transport";
  }
  return "other";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractAgentText(items: unknown[] | undefined): string | null {
  if (!items) {
    return null;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).type === "agentMessage" &&
      typeof (item as Record<string, unknown>).text === "string"
    ) {
      return (item as Record<string, unknown>).text as string;
    }
  }
  return null;
}

export interface SupervisorDaemonOptions {
  store?: SupervisorStore;
  clientFactory?: () => AppServerClient;
  pollIntervalMs?: number;
  leaseMs?: number;
}

export class SupervisorDaemon {
  private readonly store: SupervisorStore;
  private readonly clientFactory: () => AppServerClient;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly owner = randomUUID();
  private stopping = false;
  private activeClient: AppServerClient | null = null;
  private activeJobId: string | null = null;
  private activeTurnId: string | null = null;

  constructor(options: SupervisorDaemonOptions = {}) {
    this.store = options.store ?? new SupervisorStore();
    this.clientFactory = options.clientFactory ?? (() => new AppServerClient());
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.leaseMs = options.leaseMs ?? 30_000;
  }

  requestShutdown(): void {
    this.stopping = true;
    const jobId = this.activeJobId;
    const client = this.activeClient;
    const turnId = this.activeTurnId;
    const job = jobId ? this.store.getJob(jobId) : null;
    if (jobId && job?.threadId && turnId && client) {
      this.store.markPausing(jobId, "shutdown");
      void client
        .request("turn/interrupt", {
          threadId: job.threadId,
          turnId,
        })
        .catch(() => undefined);
    }
  }

  async run(): Promise<void> {
    this.store.log(null, "info", "Codex supervisor daemon started", {
      owner: this.owner,
    });

    while (!this.stopping) {
      const job = this.store.claimRunnableJob(
        Date.now(),
        this.owner,
        this.leaseMs,
      );
      if (!job) {
        await delay(this.pollIntervalMs);
        continue;
      }

      this.activeJobId = job.id;
      const leaseTimer = setInterval(() => {
        this.store.renewLease(job.id, this.owner, Date.now(), this.leaseMs);
      }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
      leaseTimer.unref();
      try {
        await this.processJob(job.id);
      } catch (error) {
        const message = errorText(error);
        this.store.log(job.id, "error", "Unhandled supervisor failure", {
          error: message,
        });
        const current = this.store.getJob(job.id);
        if (
          current &&
          current.status !== "completed" &&
          current.status !== "cancelled"
        ) {
          this.store.markNeedsAttention(job.id, message);
        }
      } finally {
        clearInterval(leaseTimer);
        this.store.releaseLease(job.id, this.owner);
        this.activeJobId = null;
        this.activeTurnId = null;
      }
    }

    this.store.log(null, "info", "Codex supervisor daemon stopped");
  }

  private async processJob(jobId: string): Promise<void> {
    let job = this.store.getJob(jobId);
    if (!job) {
      return;
    }

    if (job.desiredAction === "cancel") {
      this.store.markCancelled(jobId);
      this.store.log(jobId, "info", "Job cancelled before a turn started");
      return;
    }
    if (job.desiredAction === "pause") {
      this.store.waitManually(jobId);
      this.store.log(jobId, "info", "Job paused before a turn started");
      return;
    }

    const client = this.clientFactory();
    this.activeClient = client;
    client.onExit((error) => {
      this.store.log(jobId, "error", "Codex app-server exited", {
        error: error.message,
      });
    });

    try {
      await client.start();
      let quota = await this.readQuota(client, jobId);
      if (!quota) {
        return;
      }
      if (await this.pauseIfBlocked(jobId, quota)) {
        return;
      }

      job = this.store.getJob(jobId) as SupervisorJob;
      const resumedTurns = await this.openThread(client, job);
      if (resumedTurns) {
        const recoveredOutcome = await this.reconcileInflightTurn(
          client,
          jobId,
          resumedTurns,
        );
        if (recoveredOutcome === "stop") {
          return;
        }
        if (recoveredOutcome === "context") {
          job = this.store.getJob(jobId) as SupervisorJob;
          await this.rolloverThread(client, job);
        } else {
          job = this.store.getJob(jobId) as SupervisorJob;
          if (job.rolloverPending && !job.inflightTurnKey) {
            await this.rolloverThread(client, job);
          }
        }
      }

      while (!this.stopping) {
        job = this.store.getJob(jobId) as SupervisorJob;
        if (job.desiredAction === "cancel") {
          this.store.markCancelled(jobId);
          this.store.log(jobId, "info", "Job cancelled");
          return;
        }
        if (job.desiredAction === "pause") {
          await this.recordCheckpoint(jobId, "manual_pause", null, null);
          this.store.waitManually(jobId);
          this.store.log(jobId, "info", "Job paused");
          return;
        }

        quota = await this.readQuota(client, jobId);
        if (!quota || (await this.pauseIfBlocked(jobId, quota))) {
          return;
        }

        const outcome = await this.runTurn(client, jobId);
        if (outcome === "continue") {
          continue;
        }
        if (outcome === "context") {
          job = this.store.getJob(jobId) as SupervisorJob;
          await this.rolloverThread(client, job);
          continue;
        }
        return;
      }

      if (this.stopping) {
        await this.recordCheckpoint(jobId, "shutdown", null, null);
        this.store.markResuming(jobId, "shutdown");
      }
    } finally {
      this.activeClient = null;
      this.activeTurnId = null;
      await client.close();
    }
  }

  private async readQuota(
    client: AppServerClient,
    jobId: string,
  ): Promise<QuotaWindow[] | null> {
    try {
      const response = await client.request<RateLimitsResponseWire>(
        "account/rateLimits/read",
      );
      const windows = extractQuotaWindows(response);
      if (windows.length === 0) {
        const message =
          "No ChatGPT rate-limit windows were returned. Sign in to Codex with a ChatGPT-backed account; API-key-only authentication cannot enforce the 10% reserve.";
        this.store.markNeedsAttention(jobId, message);
        this.store.log(jobId, "error", message);
        return null;
      }
      this.store.log(jobId, "info", "Rate limits checked", { windows });
      return windows;
    } catch (error) {
      const message = `Unable to read ChatGPT rate limits: ${errorText(error)}`;
      this.store.markNeedsAttention(jobId, message);
      this.store.log(jobId, "error", message);
      return null;
    }
  }

  private async pauseIfBlocked(
    jobId: string,
    windows: QuotaWindow[],
  ): Promise<boolean> {
    const blocked = blockingQuotaWindows(windows);
    if (blocked.length === 0) {
      return false;
    }

    const job = this.store.getJob(jobId) as SupervisorJob;
    const nextResumeAt = nextQuotaCheckAt(blocked, Date.now(), job.backoffStep);
    const missingReset = blocked.some((window) => window.resetsAt === null);
    this.store.waitForQuota(
      jobId,
      blocked,
      nextResumeAt,
      missingReset ? job.backoffStep + 1 : 0,
    );
    this.store.log(jobId, "warn", "Quota reserve reached; turn not started", {
      blocked,
      nextResumeAt,
    });
    return true;
  }

  private async openThread(
    client: AppServerClient,
    job: SupervisorJob,
  ): Promise<TurnRecord[] | null> {
    if (job.rolloverPending && job.threadId && !job.inflightTurnKey) {
      await this.rolloverThread(client, job);
      return null;
    }

    if (job.threadId) {
      const response = await client.request<ThreadResponse>("thread/resume", {
        threadId: job.threadId,
        cwd: job.cwd,
        approvalPolicy: "never",
        sandbox: "workspace-write",
      });
      this.store.log(job.id, "info", "Codex thread resumed", {
        threadId: job.threadId,
      });
      return response.thread?.turns ?? [];
    }

    const response = await client.request<ThreadResponse>("thread/start", {
      cwd: job.cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      serviceName: "hyperdriver_codex_supervisor",
    });
    const threadId = response.thread?.id;
    if (!threadId) {
      throw new Error("Codex thread/start returned no thread id.");
    }
    this.store.saveThread(job.id, threadId, null, null);
    this.store.log(job.id, "info", "Codex thread started", { threadId });
    return null;
  }

  private async reconcileInflightTurn(
    client: AppServerClient,
    jobId: string,
    turns: TurnRecord[],
  ): Promise<"continue" | "context" | "stop"> {
    const job = this.store.getJob(jobId) as SupervisorJob;
    if (!job.inflightTurnKey) {
      return "continue";
    }

    const recovered = turns.find((turn) =>
      turn.items?.some(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "userMessage" &&
          (item as Record<string, unknown>).clientId === job.inflightTurnKey,
      ),
    );
    if (!recovered) {
      this.store.log(
        jobId,
        "info",
        "Prepared turn was not present in thread history; reusing its client id",
        { clientUserMessageId: job.inflightTurnKey },
      );
      return "continue";
    }

    if (recovered.status === "inProgress") {
      const message =
        "The persisted Codex turn is still active. Stop the other client or inspect the thread before resuming.";
      this.store.markNeedsAttention(jobId, message);
      this.store.log(jobId, "warn", message, { turnId: recovered.id });
      return "stop";
    }

    const agentText = extractAgentText(recovered.items);
    const result = agentText ? parseSupervisorResult(agentText) : null;
    this.store.clearCurrentTurn(jobId);
    const checkpoint = await this.recordCheckpoint(
      jobId,
      `recovered_turn_${recovered.status ?? "unknown"}`,
      null,
      result,
    );
    this.store.log(jobId, "info", "Reconciled persisted Codex turn", {
      turnId: recovered.id,
      status: recovered.status,
      clientUserMessageId: job.inflightTurnKey,
    });

    if (recovered.status === "failed") {
      const failure = classifyTurnFailure(recovered.error);
      if (failure === "quota") {
        await this.pauseAfterQuotaInterrupt(client, jobId, []);
        return "stop";
      }
      if (failure === "context") {
        this.store.updateContext(jobId, 100, true);
        this.store.markResuming(jobId, "context_rollover");
        return "context";
      }
      const message =
        failure === "auth"
          ? "Codex authentication expired. Sign in again, then run resume."
          : `Recovered Codex turn failed: ${JSON.stringify(recovered.error)}`;
      this.store.markNeedsAttention(jobId, message);
      return "stop";
    }

    if (recovered.status === "interrupted") {
      this.store.markRunning(jobId);
      return "continue";
    }

    if (!result) {
      const message =
        "Recovered Codex turn has no valid structured checkpoint result.";
      this.store.markNeedsAttention(jobId, message);
      return "stop";
    }
    if (checkpoint?.git.hasConflicts) {
      const message = "Git has unresolved conflicts; manual attention is required.";
      this.store.markNeedsAttention(jobId, message);
      return "stop";
    }
    if (result.status === "completed") {
      this.store.markCompleted(jobId);
      this.store.log(jobId, "info", "Recovered job completion", { result });
      return "stop";
    }
    if (result.status === "needs_attention") {
      this.store.markNeedsAttention(jobId, result.nextAction || result.summary);
      return "stop";
    }

    this.store.markRunning(jobId);
    return "continue";
  }

  private async rolloverThread(
    client: AppServerClient,
    job: SupervisorJob,
  ): Promise<void> {
    const previousThreadId = job.threadId;
    const response = await client.request<ThreadResponse>("thread/start", {
      cwd: job.cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      serviceName: "hyperdriver_codex_supervisor",
    });
    const threadId = response.thread?.id;
    if (!threadId) {
      throw new Error("Codex context rollover returned no thread id.");
    }

    this.store.saveThread(
      job.id,
      threadId,
      previousThreadId,
      job.contextPercent,
    );
    this.store.log(job.id, "info", "Started a fresh context thread", {
      threadId,
      previousThreadId,
      contextPercent: job.contextPercent,
    });
  }

  private async runTurn(
    client: AppServerClient,
    jobId: string,
  ): Promise<"continue" | "context" | "stop"> {
    let job = this.store.getJob(jobId) as SupervisorJob;
    if (!job.threadId) {
      throw new Error("Cannot start a turn without a thread id.");
    }

    const prepared = this.store.prepareTurn(jobId);
    job = this.store.getJob(jobId) as SupervisorJob;
    let activeTurnId: string | null = null;
    let stopReason: StopReason = null;
    let lastAgentText: string | null = null;
    let lastNotificationBlocked: QuotaWindow[] = [];
    let checkpointQueue = Promise.resolve();
    let finishWait: ((value: TurnWaitResult) => void) | null = null;
    const completion = new Promise<TurnWaitResult>((resolve) => {
      finishWait = resolve;
    });

    const interrupt = async (): Promise<void> => {
      if (!activeTurnId || !job.threadId) {
        return;
      }
      try {
        await client.request("turn/interrupt", {
          threadId: job.threadId,
          turnId: activeTurnId,
        });
      } catch (error) {
        this.store.log(jobId, "debug", "Turn interrupt was not accepted", {
          error: errorText(error),
        });
      }
    };
    const quotaGuard = new QuotaTurnGuard(interrupt);
    let contextInterruptRequested = false;

    const removeNotification = client.onNotification(
      async (message: JsonRpcNotification) => {
        const params = message.params;
        if (message.method === "turn/started") {
          const turn = params?.turn as { id?: unknown } | undefined;
          if (typeof turn?.id === "string") {
            activeTurnId = turn.id;
            this.activeTurnId = turn.id;
            this.store.setCurrentTurn(jobId, turn.id);
          }
          return;
        }

        if (message.method === "account/rateLimits/updated") {
          const windows = extractNotificationWindows(params);
          const blocked = blockingQuotaWindows(windows);
          if (blocked.length > 0) {
            lastNotificationBlocked = blocked;
            if (
              stopReason !== "cancel" &&
              stopReason !== "manual" &&
              stopReason !== "shutdown" &&
              stopReason !== "attention"
            ) {
              stopReason = "quota";
            }
            this.store.markPausing(jobId, "quota");
            await quotaGuard.observe(windows);
          }
          return;
        }

        if (message.method === "thread/tokenUsage/updated") {
          const tokenUsage = params?.tokenUsage as TokenUsageWire | undefined;
          if (!tokenUsage) {
            return;
          }
          const percent = contextUsagePercent(tokenUsage);
          if (percent !== null) {
            const rollover = shouldRolloverContext(percent);
            this.store.updateContext(jobId, percent, rollover);
            if (rollover && !contextInterruptRequested) {
              contextInterruptRequested = true;
              stopReason ??= "context";
              this.store.markPausing(jobId, "context");
              await interrupt();
            }
          }
          return;
        }

        if (message.method === "item/completed") {
          const item = params?.item as Record<string, unknown> | undefined;
          if (item?.type === "agentMessage" && typeof item.text === "string") {
            lastAgentText = item.text;
          }
          const action = describeAction(params);
          checkpointQueue = checkpointQueue.then(async () => {
            await this.recordCheckpoint(
              jobId,
              "action_completed",
              action,
              null,
            );
          });
          return;
        }

        if (message.method === "turn/completed") {
          const completedParams = params as TurnCompletedParams;
          if (
            !completedParams.threadId ||
            completedParams.threadId === job.threadId
          ) {
            finishWait?.({ kind: "completed", params: completedParams });
          }
        }
      },
    );

    const removeServerRequest = client.onServerRequest(
      async (request: JsonRpcRequest) => {
        this.respondToUnattendedRequest(client, request);
        if (stopReason !== "cancel" && stopReason !== "manual") {
          stopReason = "attention";
        }
        this.store.markPausing(jobId, "approval_or_input_required");
        await interrupt();
      },
    );
    const removeExit = client.onExit((error) => {
      finishWait?.({ kind: "exit", error });
    });

    const controlTimer = setInterval(() => {
      const current = this.store.getJob(jobId);
      if (!current) {
        return;
      }
      if (current.desiredAction === "cancel") {
        stopReason = "cancel";
        void interrupt();
      } else if (current.desiredAction === "pause") {
        if (stopReason !== "cancel") {
          stopReason = "manual";
        }
        void interrupt();
      } else if (this.stopping) {
        if (stopReason !== "cancel" && stopReason !== "manual") {
          stopReason = "shutdown";
        }
        void interrupt();
      }
      this.store.renewLease(jobId, this.owner, Date.now(), this.leaseMs);
    }, Math.min(2_000, Math.max(250, this.pollIntervalMs)));
    controlTimer.unref();

    try {
      const prompt =
        prepared.sequence === 1 && !job.checkpoint
          ? initialTurnPrompt(job)
          : continuationTurnPrompt(job, job.checkpoint, job.previousThreadId);
      const response = await client.request<TurnResponse>("turn/start", {
        threadId: job.threadId,
        clientUserMessageId: prepared.key,
        input: [{ type: "text", text: prompt }],
        cwd: job.cwd,
        approvalPolicy: "never",
        outputSchema: supervisorOutputSchema as unknown as Record<string, unknown>,
      });
      const responseTurnId = response.turn?.id;
      if (!responseTurnId) {
        throw new Error("Codex turn/start returned no turn id.");
      }
      activeTurnId = responseTurnId;
      this.activeTurnId = responseTurnId;
      this.store.setCurrentTurn(jobId, responseTurnId);
      this.store.log(jobId, "info", "Codex turn started", {
        threadId: job.threadId,
        turnId: responseTurnId,
        sequence: prepared.sequence,
      });

      if (stopReason === "quota") {
        await interrupt();
      } else if (stopReason) {
        await interrupt();
      }

      const waited = await completion;
      await checkpointQueue;
      this.activeTurnId = null;

      if (waited.kind === "exit") {
        await this.recordCheckpoint(jobId, "app_server_exit", null, null);
        this.store.markRecovering(jobId, "app_server_exit");
        return "stop";
      }

      this.store.clearCurrentTurn(jobId);

      const completedTurn = waited.params.turn;
      const readStopReason = (): StopReason => stopReason;
      let effectiveStopReason: StopReason = readStopReason();
      if (this.stopping && !effectiveStopReason) {
        effectiveStopReason = "shutdown";
      }
      lastAgentText ??= extractAgentText(completedTurn?.items);
      const result = lastAgentText ? parseSupervisorResult(lastAgentText) : null;
      const finalCheckpoint = await this.recordCheckpoint(
        jobId,
        `turn_${completedTurn?.status ?? "unknown"}`,
        null,
        result,
      );

      if (effectiveStopReason === "cancel") {
        this.store.markCancelled(jobId);
        this.store.log(jobId, "info", "Job cancelled during a turn");
        return "stop";
      }
      if (effectiveStopReason === "manual") {
        this.store.waitManually(jobId);
        this.store.log(jobId, "info", "Job paused during a turn");
        return "stop";
      }
      if (effectiveStopReason === "shutdown") {
        this.store.markResuming(jobId, "shutdown");
        return "stop";
      }
      if (effectiveStopReason === "attention") {
        this.store.markNeedsAttention(
          jobId,
          "The unattended job requested approval or user input.",
        );
        return "stop";
      }
      if (effectiveStopReason === "quota") {
        await this.pauseAfterQuotaInterrupt(client, jobId, lastNotificationBlocked);
        return "stop";
      }
      if (effectiveStopReason === "context") {
        this.store.markResuming(jobId, "context_rollover");
        return "context";
      }

      if (completedTurn?.status === "failed") {
        const failure = classifyTurnFailure(completedTurn.error);
        if (failure === "quota") {
          await this.pauseAfterQuotaInterrupt(client, jobId, []);
        } else if (failure === "context") {
          this.store.updateContext(jobId, 100, true);
          this.store.markResuming(jobId, "context_rollover");
          return "context";
        } else {
          const message =
            failure === "auth"
              ? "Codex authentication expired. Sign in again, then run resume."
              : `Codex turn failed: ${JSON.stringify(completedTurn.error)}`;
          this.store.markNeedsAttention(jobId, message);
          this.store.log(jobId, "error", message);
        }
        return "stop";
      }

      if (!result) {
        const message = "Codex turn did not return the required checkpoint result.";
        this.store.markNeedsAttention(jobId, message);
        this.store.log(jobId, "error", message);
        return "stop";
      }

      if (finalCheckpoint?.git.hasConflicts) {
        const message = "Git has unresolved conflicts; manual attention is required.";
        this.store.markNeedsAttention(jobId, message);
        this.store.log(jobId, "error", message, {
          files: finalCheckpoint.git.changedFiles,
        });
        return "stop";
      }

      if (result.status === "completed") {
        this.store.markCompleted(jobId);
        this.store.log(jobId, "info", "Job completed", {
          summary: result.summary,
          testsExecuted: result.testsExecuted,
        });
        return "stop";
      }
      if (result.status === "needs_attention") {
        this.store.markNeedsAttention(jobId, result.nextAction || result.summary);
        this.store.log(jobId, "warn", "Job needs attention", { result });
        return "stop";
      }

      this.store.markRunning(jobId);
      return "continue";
    } catch (error) {
      await checkpointQueue.catch(() => undefined);
      this.activeTurnId = null;
      await this.recordCheckpoint(jobId, "turn_start_failed", null, null);
      const failure = classifyTurnFailure(error);
      if (failure === "transport") {
        this.store.markRecovering(jobId, "app_server_transport_failure");
        return "stop";
      }
      this.store.clearCurrentTurn(jobId);
      if (failure === "quota") {
        await this.pauseAfterQuotaInterrupt(
          client,
          jobId,
          lastNotificationBlocked,
        );
        return "stop";
      }
      if (failure === "context") {
        this.store.updateContext(jobId, 100, true);
        this.store.markResuming(jobId, "context_rollover");
        return "context";
      }
      if (failure === "auth") {
        const message =
          "Codex authentication expired. Sign in again, then run resume.";
        this.store.markNeedsAttention(jobId, message);
        this.store.log(jobId, "error", message);
        return "stop";
      }
      throw error;
    } finally {
      clearInterval(controlTimer);
      removeNotification();
      removeServerRequest();
      removeExit();
    }
  }

  private async pauseAfterQuotaInterrupt(
    client: AppServerClient,
    jobId: string,
    observedBlocked: QuotaWindow[],
  ): Promise<void> {
    let blocked = observedBlocked;
    try {
      const response = await client.request<RateLimitsResponseWire>(
        "account/rateLimits/read",
      );
      const fresh = blockingQuotaWindows(extractQuotaWindows(response));
      if (fresh.length === 0) {
        this.store.markResuming(jobId, "quota_reset_during_interrupt");
        return;
      }
      blocked = fresh;
    } catch (error) {
      this.store.log(jobId, "warn", "Could not refresh quota after interrupt", {
        error: errorText(error),
      });
    }

    const current = this.store.getJob(jobId) as SupervisorJob;
    const nextResumeAt = nextQuotaCheckAt(
      blocked,
      Date.now(),
      current.backoffStep,
    );
    const missingReset =
      blocked.length === 0 ||
      blocked.some((window) => window.resetsAt === null);
    this.store.waitForQuota(
      jobId,
      blocked,
      nextResumeAt,
      missingReset ? current.backoffStep + 1 : 0,
    );
    this.store.log(jobId, "warn", "Turn interrupted to preserve 10% quota", {
      blocked,
      nextResumeAt,
    });
  }

  private respondToUnattendedRequest(
    client: AppServerClient,
    request: JsonRpcRequest,
  ): void {
    if (
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval"
    ) {
      client.respond(request.id, { decision: "decline" });
    } else if (request.method === "mcpServer/elicitation/request") {
      client.respond(request.id, { action: "cancel", content: null });
    } else {
      client.respondError(
        request.id,
        "Unattended Codex supervisor cannot answer this request.",
      );
    }
  }

  private async recordCheckpoint(
    jobId: string,
    reason: string,
    lastAction: string | null,
    result: SupervisorResult | null,
  ) {
    const job = this.store.getJob(jobId);
    if (!job) {
      return null;
    }
    const checkpoint = buildCheckpoint(job, reason, lastAction, result);
    this.store.saveCheckpoint(jobId, checkpoint);
    return checkpoint;
  }
}

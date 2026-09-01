import { spawnSync } from "node:child_process";

import type {
  GitCheckpoint,
  JobCheckpoint,
  SupervisorJob,
  SupervisorResult,
} from "./types.js";

const maxDiffCharacters = 100_000;
const compactDiffCharacters = 12_000;
const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

interface GitCommandResult {
  ok: boolean;
  stdout: string;
}

function runGit(cwd: string, args: string[]): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    ok: result.status === 0,
    stdout: result.status === 0 ? result.stdout.trimEnd() : "",
  };
}

export function parseGitStatus(status: string): {
  changedFiles: string[];
  hasConflicts: boolean;
} {
  const changedFiles: string[] = [];
  let hasConflicts = false;

  for (const line of status.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const code = line.slice(0, 2);
    const path = line.slice(3).split(" -> ").at(-1);
    if (path) {
      changedFiles.push(path);
    }
    hasConflicts ||= conflictCodes.has(code) || code.includes("U");
  }

  return { changedFiles, hasConflicts };
}

export function captureGitCheckpoint(cwd: string): GitCheckpoint {
  const commitResult = runGit(cwd, ["rev-parse", "HEAD"]);
  const statusResult = runGit(cwd, ["status", "--short"]);
  const workingDiff = runGit(cwd, ["diff", "--no-ext-diff", "--binary"]);
  const stagedDiff = runGit(cwd, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--binary",
  ]);
  const rawDiff = [workingDiff.stdout, stagedDiff.stdout]
    .filter(Boolean)
    .join("\n");
  const parsedStatus = parseGitStatus(statusResult.stdout);

  return {
    commit: commitResult.ok ? commitResult.stdout || null : null,
    status: statusResult.stdout,
    changedFiles: parsedStatus.changedFiles,
    hasConflicts: parsedStatus.hasConflicts,
    diff: rawDiff.slice(0, maxDiffCharacters),
    diffTruncated: rawDiff.length > maxDiffCharacters,
  };
}

export function describeAction(params: Record<string, unknown> | undefined): string {
  const item = params?.item;
  if (!item || typeof item !== "object") {
    return "Codex item completed";
  }

  const typedItem = item as Record<string, unknown>;
  const type = typeof typedItem.type === "string" ? typedItem.type : "item";
  if (type === "commandExecution" && typeof typedItem.command === "string") {
    return `Command: ${typedItem.command}`;
  }
  if (type === "fileChange") {
    return "File changes applied";
  }
  if (type === "mcpToolCall") {
    const server = typeof typedItem.server === "string" ? typedItem.server : "MCP";
    const tool = typeof typedItem.tool === "string" ? typedItem.tool : "tool";
    return `Tool: ${server}/${tool}`;
  }

  return `${type} completed`;
}

export function parseSupervisorResult(text: string): SupervisorResult | null {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const value = JSON.parse(candidate) as Partial<SupervisorResult>;
    if (
      !["continue", "completed", "needs_attention"].includes(value.status ?? "") ||
      typeof value.summary !== "string" ||
      !Array.isArray(value.decisions) ||
      !value.decisions.every((entry) => typeof entry === "string") ||
      !Array.isArray(value.testsExecuted) ||
      !value.testsExecuted.every((entry) => typeof entry === "string") ||
      typeof value.nextAction !== "string"
    ) {
      return null;
    }

    return value as SupervisorResult;
  } catch {
    return null;
  }
}

export function buildCheckpoint(
  job: SupervisorJob,
  reason: string,
  lastAction: string | null,
  result?: SupervisorResult | null,
): JobCheckpoint {
  return {
    objective: job.goal,
    reason,
    recordedAt: Date.now(),
    threadId: job.threadId,
    previousThreadId: job.previousThreadId,
    turnId: job.currentTurnId,
    turnSequence: job.turnSequence,
    lastAction,
    summary: result?.summary ?? job.checkpoint?.summary ?? "",
    decisions: result?.decisions ?? job.checkpoint?.decisions ?? [],
    testsExecuted: result?.testsExecuted ?? job.checkpoint?.testsExecuted ?? [],
    nextAction: result?.nextAction ?? job.checkpoint?.nextAction ?? "Inspect current state and continue safely.",
    git: captureGitCheckpoint(job.cwd),
  };
}

export function compactCheckpoint(checkpoint: JobCheckpoint | null): string {
  if (!checkpoint) {
    return "No earlier checkpoint is available. Inspect the repository before acting.";
  }

  return JSON.stringify({
    objective: checkpoint.objective,
    recordedAt: new Date(checkpoint.recordedAt).toISOString(),
    priorThreadId: checkpoint.threadId,
    priorPriorThreadId: checkpoint.previousThreadId,
    turnSequence: checkpoint.turnSequence,
    summary: checkpoint.summary,
    decisions: checkpoint.decisions,
    testsExecuted: checkpoint.testsExecuted,
    nextAction: checkpoint.nextAction,
    lastAction: checkpoint.lastAction,
    git: {
      commit: checkpoint.git.commit,
      status: checkpoint.git.status,
      changedFiles: checkpoint.git.changedFiles,
      hasConflicts: checkpoint.git.hasConflicts,
      diff: checkpoint.git.diff.slice(0, compactDiffCharacters),
      diffTruncated:
        checkpoint.git.diffTruncated ||
        checkpoint.git.diff.length > compactDiffCharacters,
    },
  });
}

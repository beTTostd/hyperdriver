import type { JobCheckpoint, SupervisorJob } from "./types.js";
import { compactCheckpoint } from "./checkpoint.js";

export const supervisorOutputSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["continue", "completed", "needs_attention"],
    },
    summary: { type: "string" },
    decisions: {
      type: "array",
      items: { type: "string" },
    },
    testsExecuted: {
      type: "array",
      items: { type: "string" },
    },
    nextAction: { type: "string" },
  },
  required: [
    "status",
    "summary",
    "decisions",
    "testsExecuted",
    "nextAction",
  ],
  additionalProperties: false,
} as const;

const operatingContract = `
You are working under a persistent local supervisor. Work autonomously toward
the objective inside the supplied working directory. Before changing anything,
inspect the repository and the current Git state. Preserve existing user work.
Do not repeat a command or edit already reflected in the checkpoint or current
repository. Make incremental, verifiable progress and run proportionate tests.
Never buy credits, consume rate-limit reset credits, or make purchases.

At the end of this turn, return the required structured result. Use "completed"
only if the objective is genuinely finished and verified. Use "continue" when
another autonomous turn is needed. Use "needs_attention" only when progress
requires a user decision, renewed authentication, external authority, or a
conflict that cannot be resolved safely.`.trim();

export function initialTurnPrompt(job: SupervisorJob): string {
  return `${operatingContract}\n\nObjective:\n${job.goal}`;
}

export function continuationTurnPrompt(
  job: SupervisorJob,
  checkpoint: JobCheckpoint | null,
  previousThreadId?: string | null,
): string {
  const threadNote = previousThreadId
    ? `\nThis is a fresh context thread continuing thread ${previousThreadId}.`
    : "";
  return `${operatingContract}${threadNote}\n\nObjective:\n${job.goal}\n\nCompact checkpoint:\n${compactCheckpoint(checkpoint)}`;
}

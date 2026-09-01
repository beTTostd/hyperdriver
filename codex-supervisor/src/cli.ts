#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SupervisorDaemon } from "./supervisor.js";
import { SupervisorStore } from "./store.js";
import type { LogRecord, QuotaWindow, SupervisorJob } from "./types.js";

const usage = `Usage:
  codex-supervisor start --cwd <project> --goal "<objective>" [--thread-id <id>]
  codex-supervisor status [--json]
  codex-supervisor pause
  codex-supervisor resume
  codex-supervisor cancel
  codex-supervisor logs [--follow]
  codex-supervisor install-service
  codex-supervisor daemon`;

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    return null;
  }
  return args[index + 1];
}

function formatTime(value: number | null): string {
  return value === null ? "-" : new Date(value).toISOString();
}

function formatWindow(window: QuotaWindow): string {
  return `${window.bucketId}/${window.slot} (${window.label}): ${window.usedPercent.toFixed(1)}% used, ${window.remainingPercent.toFixed(1)}% remaining, reset ${
    window.resetsAt === null
      ? "unknown"
      : new Date(window.resetsAt * 1_000).toISOString()
  }`;
}

function printStatus(job: SupervisorJob | null, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(job, null, 2));
    return;
  }
  if (!job) {
    console.log("No supervisor job has been created.");
    return;
  }

  console.log(`Job: ${job.id}`);
  console.log(`Status: ${job.status}${job.waitingReason ? ` (${job.waitingReason})` : ""}`);
  console.log(`Goal: ${job.goal}`);
  console.log(`Working directory: ${job.cwd}`);
  console.log(`Thread: ${job.threadId ?? "-"}`);
  console.log(`Previous thread: ${job.previousThreadId ?? "-"}`);
  console.log(`Active turn: ${job.currentTurnId ?? "-"}`);
  console.log(`Turn sequence: ${job.turnSequence}`);
  console.log(
    `Context: ${job.contextPercent === null ? "-" : `${job.contextPercent.toFixed(1)}%`}`,
  );
  console.log(`Next quota check: ${formatTime(job.nextResumeAt)}`);
  if (job.lastError) {
    console.log(`Attention: ${job.lastError}`);
  }
  if (job.blockedWindows.length > 0) {
    console.log("Blocked quota windows:");
    for (const window of job.blockedWindows) {
      console.log(`  - ${formatWindow(window)}`);
    }
  }
  if (job.checkpoint) {
    console.log(`Last checkpoint: ${formatTime(job.checkpoint.recordedAt)}`);
    console.log(`Next action: ${job.checkpoint.nextAction}`);
  }
}

function printLog(record: LogRecord): void {
  const details = record.details === null ? "" : ` ${JSON.stringify(record.details)}`;
  console.log(
    `${new Date(record.createdAt).toISOString()} ${record.level.toUpperCase()} ${record.message}${details}`,
  );
}

function startUserService(): boolean {
  const result = spawnSync(
    "systemctl",
    ["--user", "start", "codex-supervisor.service"],
    { encoding: "utf8", stdio: "pipe" },
  );
  return result.status === 0;
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function installService(): void {
  const cliPath = fileURLToPath(import.meta.url);
  const binPath = resolve(
    process.env.HOME || "",
    ".local",
    "bin",
    "codex-supervisor",
  );
  const unitPath = resolve(
    process.env.XDG_CONFIG_HOME || resolve(process.env.HOME || "", ".config"),
    "systemd",
    "user",
    "codex-supervisor.service",
  );
  if (!process.env.HOME && !process.env.XDG_CONFIG_HOME) {
    throw new Error("HOME or XDG_CONFIG_HOME is required to install the user service.");
  }

  if (!process.env.HOME) {
    throw new Error("HOME is required to install the codex-supervisor command.");
  }

  mkdirSync(dirname(unitPath), { recursive: true });
  mkdirSync(dirname(binPath), { recursive: true });
  writeFileSync(
    binPath,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  const unit = `[Unit]
Description=Persistent local supervisor for Codex jobs
After=default.target
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=${systemdQuote(process.execPath)} ${systemdQuote(cliPath)} daemon
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=mixed

[Install]
WantedBy=default.target
`;
  writeFileSync(unitPath, unit, { encoding: "utf8", mode: 0o644 });

  const reload = spawnSync("systemctl", ["--user", "daemon-reload"], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (reload.status !== 0) {
    throw new Error("systemctl --user daemon-reload failed.");
  }
  const enable = spawnSync(
    "systemctl",
    ["--user", "enable", "--now", "codex-supervisor.service"],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (enable.status !== 0) {
    throw new Error("Could not enable the Codex supervisor user service.");
  }
  console.log(`Installed ${binPath}`);
  console.log(`Installed and started ${unitPath}`);
}

async function runDaemon(store: SupervisorStore): Promise<void> {
  const daemon = new SupervisorDaemon({ store });
  const shutdown = () => daemon.requestShutdown();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await daemon.run();
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (!command || command === "help" || command === "--help") {
    console.log(usage);
    return;
  }

  if (command === "install-service") {
    installService();
    return;
  }

  const store = new SupervisorStore();
  try {
    if (command === "daemon") {
      await runDaemon(store);
      return;
    }

    if (command === "start") {
      const cwdArgument = argumentValue(args, "--cwd");
      const goal = argumentValue(args, "--goal");
      const threadId = argumentValue(args, "--thread-id") ?? undefined;
      if (!cwdArgument || !goal?.trim()) {
        throw new Error("start requires --cwd and a non-empty --goal.");
      }
      const cwd = resolve(cwdArgument);
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      const job = store.createJob(randomUUID(), cwd, goal.trim(), threadId);
      store.log(job.id, "info", "Job created", {
        cwd,
        attachedThreadId: threadId ?? null,
      });
      console.log(`Created job ${job.id}.`);
      if (!startUserService()) {
        console.log(
          "The user service is not installed or could not be started. Run: codex-supervisor install-service",
        );
      }
      return;
    }

    if (command === "status") {
      printStatus(store.getActiveJob() ?? store.getLatestJob(), args.includes("--json"));
      return;
    }

    if (["pause", "resume", "cancel"].includes(command)) {
      const job = store.getActiveJob();
      if (!job) {
        throw new Error("There is no unfinished supervisor job.");
      }
      const updated = store.requestAction(
        job.id,
        command as "pause" | "resume" | "cancel",
      );
      console.log(`Job ${updated.id}: ${updated.status}.`);
      if (["pause", "resume", "cancel"].includes(command)) {
        startUserService();
      }
      return;
    }

    if (command === "logs") {
      const job = store.getActiveJob() ?? store.getLatestJob();
      if (!job) {
        console.log("No supervisor logs are available.");
        return;
      }
      let afterId = 0;
      do {
        const records = store.listLogs(job.id, afterId);
        for (const record of records) {
          printLog(record);
          afterId = record.id;
        }
        if (!args.includes("--follow")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      } while (true);
      return;
    }

    throw new Error(`Unknown command: ${command}\n\n${usage}`);
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

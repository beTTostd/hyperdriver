import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseGitStatus,
  parseSupervisorResult,
} from "../codex-supervisor/dist/checkpoint.js";
import {
  contextUsagePercent,
  shouldRolloverContext,
} from "../codex-supervisor/dist/context.js";
import {
  blockingQuotaWindows,
  extractNotificationWindows,
  extractQuotaWindows,
  nextQuotaCheckAt,
  QuotaTurnGuard,
  usedPercentLimit,
} from "../codex-supervisor/dist/rate-limits.js";
import { SupervisorStore } from "../codex-supervisor/dist/store.js";
import {
  classifyTurnFailure,
  SupervisorDaemon,
} from "../codex-supervisor/dist/supervisor.js";

function quotaPayload(fiveHourUsed, weeklyUsed, fiveHourReset = 1_000, weeklyReset = 2_000) {
  return {
    rateLimits: {
      limitId: "legacy",
      primary: {
        usedPercent: 1,
        windowDurationMins: 15,
        resetsAt: 50,
      },
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        limitName: "Codex",
        primary: {
          usedPercent: fiveHourUsed,
          windowDurationMins: 300,
          resetsAt: fiveHourReset,
        },
        secondary: {
          usedPercent: weeklyUsed,
          windowDurationMins: 10_080,
          resetsAt: weeklyReset,
        },
      },
    },
  };
}

test("the 10% reserve is enforced independently for five-hour and weekly windows", () => {
  assert.equal(usedPercentLimit, 90);
  const windows = extractQuotaWindows(quotaPayload(89.9, 90));

  assert.deepEqual(
    windows.map((window) => window.label),
    ["5 hours", "weekly"],
  );
  assert.equal(blockingQuotaWindows(windows).length, 1);
  assert.equal(blockingQuotaWindows(windows)[0].label, "weekly");

  const fiveHourBlocked = extractQuotaWindows(quotaPayload(90, 12));
  assert.equal(blockingQuotaWindows(fiveHourBlocked)[0].label, "5 hours");
});

test("multi-bucket quota data takes precedence over the legacy view", () => {
  const windows = extractQuotaWindows(quotaPayload(12, 34));
  assert.equal(windows.length, 2);
  assert.ok(windows.every((window) => window.bucketId === "codex"));
});

test("a rolling quota update interrupts an active turn exactly once", async () => {
  let interrupts = 0;
  const guard = new QuotaTurnGuard(async () => {
    interrupts += 1;
  });
  const safe = extractNotificationWindows({
    rateLimits: quotaPayload(89, 0).rateLimitsByLimitId.codex,
  });
  const blocked = extractNotificationWindows({
    rateLimits: quotaPayload(90, 0).rateLimitsByLimitId.codex,
  });

  assert.equal(await guard.observe(safe), false);
  assert.equal(await guard.observe(blocked), true);
  assert.equal(await guard.observe(blocked), false);
  assert.equal(interrupts, 1);
});

test("quota resume uses the greatest reset plus 30 seconds", () => {
  const blocked = blockingQuotaWindows(extractQuotaWindows(quotaPayload(90, 95)));
  assert.equal(nextQuotaCheckAt(blocked, 100, 0), 2_030_000);
});

test("missing reset timestamps use bounded exponential backoff", () => {
  const windows = extractQuotaWindows(quotaPayload(90, 10, null, 2_000));
  const now = 50_000;
  assert.equal(nextQuotaCheckAt(blockingQuotaWindows(windows), now, 0), now + 900_000);
  assert.equal(
    nextQuotaCheckAt(blockingQuotaWindows(windows), now, 4),
    now + 21_600_000,
  );
  assert.equal(
    nextQuotaCheckAt(blockingQuotaWindows(windows), now, 20),
    now + 21_600_000,
  );
  assert.equal(nextQuotaCheckAt([], now, 0), now + 900_000);
});

test("context rollover begins at 75 percent", () => {
  const percent = contextUsagePercent({
    last: { totalTokens: 75_000 },
    modelContextWindow: 100_000,
  });
  assert.equal(percent, 75);
  assert.equal(shouldRolloverContext(percent), true);
  assert.equal(
    shouldRolloverContext(
      contextUsagePercent({
        last: { totalTokens: 74_999 },
        modelContextWindow: 100_000,
      }),
    ),
    false,
  );
});

test("Git conflicts and structured turn results are recognized", () => {
  assert.deepEqual(parseGitStatus("UU app/page.tsx\n M README.md"), {
    changedFiles: ["app/page.tsx", "README.md"],
    hasConflicts: true,
  });
  assert.deepEqual(
    parseSupervisorResult(
      JSON.stringify({
        status: "continue",
        summary: "Implemented the parser",
        decisions: ["Kept browser-only replay parsing"],
        testsExecuted: ["node --test parser.test.mjs"],
        nextAction: "Run the full suite",
      }),
    ),
    {
      status: "continue",
      summary: "Implemented the parser",
      decisions: ["Kept browser-only replay parsing"],
      testsExecuted: ["node --test parser.test.mjs"],
      nextAction: "Run the full suite",
    },
  );
});

test("authentication, quota, and context failures are classified safely", () => {
  assert.equal(classifyTurnFailure({ codexErrorInfo: "Unauthorized", httpStatusCode: 401 }), "auth");
  assert.equal(classifyTurnFailure({ codexErrorInfo: "UsageLimitExceeded" }), "quota");
  assert.equal(classifyTurnFailure({ codexErrorInfo: "ContextWindowExceeded" }), "context");
  assert.equal(
    classifyTurnFailure(new Error("Codex app-server exited unexpectedly")),
    "transport",
  );
  assert.equal(classifyTurnFailure({ message: "compiler failed" }), "other");
});

test("SQLite leases prevent duplicate resumptions and survive daemon restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-supervisor-store-"));
  const database = join(directory, "state.sqlite");
  const first = new SupervisorStore(database);
  const second = new SupervisorStore(database);
  try {
    const job = first.createJob("job-1", directory, "finish the task");
    assert.equal(job.status, "resuming");

    const claimed = first.claimRunnableJob(1_000, "daemon-a", 30_000);
    assert.equal(claimed?.id, "job-1");
    assert.equal(second.claimRunnableJob(1_001, "daemon-b", 30_000), null);

    const prepared = first.prepareTurn("job-1");
    const repeatedPreparation = first.prepareTurn("job-1");
    assert.deepEqual(repeatedPreparation, prepared);

    first.markRecovering("job-1", "app_server_exit");
    first.releaseLease("job-1", "daemon-a");
    const afterBoot = second.claimRunnableJob(2_000, "daemon-b", 30_000);
    assert.equal(afterBoot?.id, "job-1");
    assert.deepEqual(second.prepareTurn("job-1"), prepared);
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("changed reset times postpone automatic resume without duplicate claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-supervisor-reset-"));
  const database = join(directory, "state.sqlite");
  const first = new SupervisorStore(database);
  const restarted = new SupervisorStore(database);
  try {
    first.createJob("job-reset", directory, "wait safely");
    first.claimRunnableJob(1_000, "daemon-a", 30_000);
    const blocked = blockingQuotaWindows(extractQuotaWindows(quotaPayload(95, 1)));
    first.waitForQuota("job-reset", blocked, 5_000, 0);
    first.releaseLease("job-reset", "daemon-a");

    assert.equal(restarted.claimRunnableJob(4_999, "daemon-b", 30_000), null);
    const due = restarted.claimRunnableJob(5_000, "daemon-b", 30_000);
    assert.equal(due?.status, "resuming");

    restarted.waitForQuota("job-reset", blocked, 20_000, 0);
    restarted.releaseLease("job-reset", "daemon-b");
    assert.equal(first.claimRunnableJob(10_000, "daemon-a", 30_000), null);
    assert.equal(first.claimRunnableJob(20_000, "daemon-a", 30_000)?.id, "job-reset");
  } finally {
    first.close();
    restarted.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a completed persisted turn is reconciled instead of started again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-supervisor-reconcile-"));
  const database = join(directory, "state.sqlite");
  const store = new SupervisorStore(database);
  try {
    store.createJob("job-reconcile", directory, "complete once");
    store.saveThread("job-reconcile", "thread-1", null, null);
    const prepared = store.prepareTurn("job-reconcile");
    const result = {
      status: "completed",
      summary: "Already finished",
      decisions: [],
      testsExecuted: ["npm test"],
      nextAction: "None",
    };
    const daemon = new SupervisorDaemon({ store });

    const outcome = await daemon.reconcileInflightTurn(
      {},
      "job-reconcile",
      [
        {
          id: "turn-1",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "message-1",
              clientId: prepared.key,
              content: [],
            },
            {
              type: "agentMessage",
              id: "message-2",
              text: JSON.stringify(result),
            },
          ],
        },
      ],
    );

    assert.equal(outcome, "stop");
    assert.equal(store.getJob("job-reconcile")?.status, "completed");
    assert.equal(store.getJob("job-reconcile")?.turnSequence, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

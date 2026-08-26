import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const tableSource = readFileSync(
  fileURLToPath(new URL("../app/table/replay-table.tsx", import.meta.url)),
  "utf8",
);
const tableStyles = readFileSync(
  fileURLToPath(new URL("../app/table/replay-table.module.css", import.meta.url)),
  "utf8",
);
const reportSource = readFileSync(
  fileURLToPath(new URL("../app/telemetry/[id]/page.tsx", import.meta.url)),
  "utf8",
);
const reportStyles = readFileSync(
  fileURLToPath(new URL("../app/telemetry/[id]/page.module.css", import.meta.url)),
  "utf8",
);
const replayTablePageSource = readFileSync(
  fileURLToPath(new URL("../app/replays/[id]/table/page.tsx", import.meta.url)),
  "utf8",
);
const statsSource = readFileSync(
  fileURLToPath(new URL("../app/me/stats/page.tsx", import.meta.url)),
  "utf8",
);
const analysisRouteSource = readFileSync(
  fileURLToPath(new URL("../app/api/replays/[id]/analysis/route.ts", import.meta.url)),
  "utf8",
);
const feedbackRouteSource = readFileSync(
  fileURLToPath(new URL("../app/api/replays/[id]/analysis/feedback/route.ts", import.meta.url)),
  "utf8",
);
const decisionAnalysisSource = readFileSync(
  fileURLToPath(new URL("../lib/decision-analysis.ts", import.meta.url)),
  "utf8",
);

test("keeps decision details at the bottom of the replay side panel", () => {
  const panelPlacements = tableSource.match(
    /<DecisionSidebarPanel decision=\{selectedDecision\} replayId=\{replayId\} \/>/g,
  ) ?? [];

  assert.equal(panelPlacements.length, 2, "desktop sidebar and responsive drawer should share the decision panel");
  assert.equal(
    tableSource.match(/showDecisionAnalysis && <DecisionSidebarPanel/g)?.length,
    2,
    "both decision panels should require administrator visibility",
  );
  assert.match(tableSource, /<aside className=\{styles\.sidebar\}[\s\S]*<LiveValuePanel[\s\S]*<DecisionSidebarPanel[\s\S]*<\/aside>/);
  assert.match(tableSource, /setSidebarCollapsed\(false\);\s+setValueOpen\(true\);/);
  assert.match(tableStyles, /\.sidebar \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*overflow: hidden;/);
  assert.match(tableStyles, /\.decisionSidebar \{[\s\S]*flex: 0 0 auto;[\s\S]*overflow-y: auto;/);
  assert.doesNotMatch(tableSource, /decisionOverlay/);
  assert.doesNotMatch(tableStyles, /decisionOverlay/);
});

test("keeps decision analysis behind the administrator role in UI and APIs", () => {
  assert.match(decisionAnalysisSource, /export function decisionAnalysisVisibleTo[\s\S]*return role === "admin";/);
  assert.doesNotMatch(decisionAnalysisSource, /DECISION_ANALYSIS_RELEASE_MODE/);
  assert.match(replayTablePageSource, /decisionAnalysisEnabled=\{decisionAnalysisVisibleTo\(currentUser\.role\)\}/);
  assert.match(tableSource, /if \(decisionAnalysisEnabled && requestedReplayId && isReplayId\(requestedReplayId\)\)/);
  assert.match(reportSource, /decisionAnalysisVisibleTo\(currentUser\.role\)[\s\S]*\? getReplayDecisionAnalysis[\s\S]*: null;/);
  assert.match(statsSource, /const decisionAnalysisVisible = decisionAnalysisVisibleTo\(currentUser\.role\);/);
  assert.match(analysisRouteSource, /if \(!decisionAnalysisVisibleTo\(user\.role\)\)[\s\S]*status: 404/);
  assert.match(feedbackRouteSource, /if \(!decisionAnalysisVisibleTo\(user\.role\)\)[\s\S]*status: 404/);
});

test("hides improvement comparison cards when the marker is a good decision", () => {
  assert.match(tableSource, /decision\.marker !== "good" && \([\s\S]*<small>Melhor linha encontrada<\/small>/);
  assert.match(tableSource, /decision\.marker !== "good" && <p className=\{styles\.decisionSidebarExplanation\}><b>Por que apareceu:<\/b>/);
  assert.match(reportSource, /item\.marker !== "good" && <p className=\{styles\.decisionMeaning\}><strong>Por que este marcador apareceu:<\/strong>/);
  assert.match(reportSource, /item\.marker !== "good" && \([\s\S]*<small>Melhor linha encontrada<\/small>/);
  assert.match(reportSource, /item\.marker !== "good" && <p>\{item\.explanation\}<\/p>/);
  assert.match(reportSource, /item\.marker === "good" \? styles\.singleDecisionComparison/);
  assert.match(reportStyles, /\.singleDecisionComparison \{ grid-template-columns: 1fr; \}/);
});

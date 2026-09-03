import { createHash, createHmac } from "node:crypto";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../db";
import {
  analysisFeedback,
  analysisModelVersions,
  decisionDatasetExamples,
  decisionObservations,
  handAnalyses,
  replayAnalyses,
  replays,
} from "../db/schema";
import {
  analyzeReplayDecisions,
  publicDecisionDatasetExample,
} from "./decision-analysis-core.js";
import { getReplayStorage } from "./replay-storage";
import type { ReplayDocument, ReplayMetadata } from "./replays";

export type AnalysisStatus = "pending" | "ready" | "insufficient_data" | "failed";
export type AnalysisConfidence = "high" | "medium" | "low";
export type DecisionMarker = "good" | "opportunity" | "high_impact_error" | null;

export type DecisionAction = {
  key: string;
  actionCode: string;
  zone: string | null;
  identifier: string;
  input: string | null;
  label: string;
  source: string;
  pitchValue: number | null;
  cardType: string | null;
  estimatedWinProbability?: number;
  utility?: number;
  decomposition?: DecisionDecomposition;
};

export type DecisionDecomposition = {
  expectedDamage: number;
  lifePreserved: number;
  cardsConsumed: number;
  wastedPitch: number;
  arsenalQuality: number;
  equipmentSpent: number;
  chainContinuity: number;
  firstTurnCardsReplaced: number;
};

export type DecisionObservation = {
  ordinal: number;
  frameSequence: number;
  frameIndex: number;
  turn: number | null;
  kind: string;
  state: Record<string, unknown>;
  legalActions: DecisionAction[];
  chosenAction: DecisionAction | null;
  stateFingerprint: string;
  handFingerprint: string;
  dataQuality: "captured" | "inferred" | "insufficient";
};

export type HandAnalysis = {
  observationOrdinal: number;
  stateFingerprint: string;
  handFingerprint: string;
  frameSequence: number;
  frameIndex: number;
  turn: number | null;
  decisionKind: string;
  decisionLabel: string;
  handPotential: number;
  executionQuality: number;
  chosenAction: DecisionAction & { estimatedWinProbability: number; decomposition: DecisionDecomposition };
  chosenActionValue: number;
  bestAction: DecisionAction & { estimatedWinProbability: number; decomposition: DecisionDecomposition };
  bestActionValue: number;
  alternatives: Array<DecisionAction & { estimatedWinProbability: number; decomposition: DecisionDecomposition }>;
  regretPp: number;
  confidence: AnalysisConfidence;
  marker: DecisionMarker;
  explanation: string;
  improvementTags: string[];
  evidence: string;
};

export type AnalysisSummary = {
  evaluatedDecisions: number;
  lowConfidenceDecisions: number;
  averageHandPotential: number | null;
  averageExecutionQuality: number | null;
  varianceLimitedHands: number;
  executionBelowPotential: number;
  controllablePatterns: Array<{
    tag: string;
    label: string;
    occurrences: number;
    averageRegretPp: number;
  }>;
  deckSignals: Array<{
    tag: string;
    label: string;
    occurrences: number;
    confidenceIntervalExcludesNeutral: boolean;
  }>;
  deckRecommendations: never[];
};

export type AnalysisVersions = {
  analysisSchema: string;
  replaySchema: string;
  evaluator: string;
  cardCatalog: string;
  rules: string;
  talisharCommit: string;
};

export type ReplayDecisionAnalysis = {
  status: AnalysisStatus;
  observationCount: number;
  analysisCount: number;
  versions: AnalysisVersions | null;
  summary: AnalysisSummary | null;
  methodology: {
    primaryObjective: string;
    optimizationLabel: string;
    usesFinalResult: boolean;
    collectiveEvidenceUsed: boolean;
    simulatorUsed: boolean;
    note: string;
  } | null;
  handAnalyses: HandAnalysis[];
  recommendationsVisible: boolean;
  shadowMode: boolean;
  reason?: string;
  updatedAt?: number;
};

type CoreAnalysis = {
  status: AnalysisStatus;
  versions: AnalysisVersions;
  observations: DecisionObservation[];
  analyses: HandAnalysis[];
  summary: AnalysisSummary;
  methodology: NonNullable<ReplayDecisionAnalysis["methodology"]>;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function configuredVersions(document: ReplayDocument) {
  return {
    replaySchema: document.schemaVersion,
    evaluator: process.env.DECISION_EVALUATOR_VERSION,
    cardCatalog: process.env.CARD_CATALOG_VERSION,
    rules: process.env.FAB_RULES_VERSION,
    talisharCommit: process.env.TALISHAR_COMPATIBLE_COMMIT,
  };
}

function modelVersionId(versions: AnalysisVersions): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      analysisSchema: versions.analysisSchema,
      evaluator: versions.evaluator,
      cardCatalog: versions.cardCatalog,
      rules: versions.rules,
      talisharCommit: versions.talisharCommit,
    }))
    .digest("hex")
    .slice(0, 16);
  return `${versions.evaluator}:${digest}`;
}

function collectiveAnalysisEnabled() {
  if (process.env.COLLECTIVE_ANALYSIS_ENABLED === "false") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return (process.env.ANALYSIS_PSEUDONYM_SALT?.length ?? 0) >= 32;
}

function userCohort(userId: number): string {
  const salt = process.env.ANALYSIS_PSEUDONYM_SALT || "hyperdriver-collective-analysis-v1";
  return createHmac("sha256", salt).update(String(userId)).digest("hex");
}

function datasetKey(replayId: number, observation: DecisionObservation, modelId: string): string {
  return createHash("sha256")
    .update(`${replayId}:${observation.stateFingerprint}:${modelId}`)
    .digest("hex");
}

function errorCode(error: unknown): string {
  if (error instanceof SyntaxError) return "INVALID_REPLAY_JSON";
  if (error instanceof Error && /not found/i.test(error.message)) return "REPLAY_NOT_FOUND";
  return "ANALYSIS_FAILED";
}

export function markReplayAnalysisPending(replayId: number): void {
  const now = Date.now();
  getDb()
    .insert(replayAnalyses)
    .values({ replayId, status: "pending", queuedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: replayAnalyses.replayId,
      set: {
        status: "pending",
        errorCode: null,
        queuedAt: now,
        updatedAt: now,
      },
    })
    .run();
}

export function replayAnalysisStatus(replayId: number): AnalysisStatus | null {
  return getDb()
    .select({ status: replayAnalyses.status })
    .from(replayAnalyses)
    .where(eq(replayAnalyses.replayId, replayId))
    .get()?.status as AnalysisStatus | undefined ?? null;
}

export async function processReplayAnalysis(
  replayId: number,
  suppliedDocument?: ReplayDocument,
): Promise<AnalysisStatus> {
  const database = getDb();
  const metadata = database.select().from(replays).where(eq(replays.id, replayId)).get();
  if (!metadata) throw new Error("Replay not found.");

  try {
    const document = suppliedDocument ?? JSON.parse(
      await getReplayStorage().read(metadata.storageKey),
    ) as ReplayDocument;
    const result = analyzeReplayDecisions(
      document,
      configuredVersions(document),
    ) as CoreAnalysis;
    const modelId = modelVersionId(result.versions);
    const now = Date.now();

    database.transaction((transaction) => {
      transaction
        .insert(analysisModelVersions)
        .values({
          id: modelId,
          analysisSchema: result.versions.analysisSchema,
          evaluatorVersion: result.versions.evaluator,
          cardCatalogVersion: result.versions.cardCatalog,
          rulesVersion: result.versions.rules,
          talisharCommit: result.versions.talisharCommit,
        })
        .onConflictDoNothing()
        .run();

      transaction.delete(decisionDatasetExamples).where(eq(decisionDatasetExamples.replayId, replayId)).run();
      transaction.delete(decisionObservations).where(eq(decisionObservations.replayId, replayId)).run();

      const observationIds = new Map<number, number>();
      for (const observation of result.observations) {
        const inserted = transaction
          .insert(decisionObservations)
          .values({
            replayId,
            ordinal: observation.ordinal,
            frameSequence: observation.frameSequence,
            frameIndex: observation.frameIndex,
            turn: observation.turn,
            kind: observation.kind,
            stateFingerprint: observation.stateFingerprint,
            handFingerprint: observation.handFingerprint,
            dataQuality: observation.dataQuality,
            stateJson: JSON.stringify(observation.state),
            legalActionsJson: JSON.stringify(observation.legalActions),
            chosenActionJson: observation.chosenAction ? JSON.stringify(observation.chosenAction) : null,
          })
          .returning({ id: decisionObservations.id })
          .get();
        observationIds.set(observation.ordinal, inserted.id);

        if (collectiveAnalysisEnabled() && observation.dataQuality !== "insufficient") {
          transaction.insert(decisionDatasetExamples).values({
            replayId,
            modelVersionId: modelId,
            exampleKey: datasetKey(replayId, observation, modelId),
            userCohort: userCohort(metadata.userId),
            decisionKind: observation.kind,
            payloadJson: JSON.stringify(publicDecisionDatasetExample(observation, metadata)),
          }).run();
        }
      }

      for (const analysis of result.analyses) {
        const observationId = observationIds.get(analysis.observationOrdinal);
        if (!observationId) continue;
        transaction.insert(handAnalyses).values({
          replayId,
          observationId,
          modelVersionId: modelId,
          stateFingerprint: analysis.stateFingerprint,
          frameSequence: analysis.frameSequence,
          frameIndex: analysis.frameIndex,
          turn: analysis.turn,
          decisionKind: analysis.decisionKind,
          marker: analysis.marker,
          confidence: analysis.confidence,
          handPotential: analysis.handPotential,
          executionQuality: analysis.executionQuality,
          chosenValue: analysis.chosenActionValue,
          bestValue: analysis.bestActionValue,
          regretPp: analysis.regretPp,
          tagsJson: JSON.stringify(analysis.improvementTags),
          analysisJson: JSON.stringify(analysis),
        }).run();
      }

      transaction
        .insert(replayAnalyses)
        .values({
          replayId,
          modelVersionId: modelId,
          status: result.status,
          observationCount: result.observations.length,
          analysisCount: result.analyses.length,
          summaryJson: JSON.stringify(result.summary),
          methodologyJson: JSON.stringify(result.methodology),
          errorCode: null,
          queuedAt: now,
          analyzedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: replayAnalyses.replayId,
          set: {
            modelVersionId: modelId,
            status: result.status,
            observationCount: result.observations.length,
            analysisCount: result.analyses.length,
            summaryJson: JSON.stringify(result.summary),
            methodologyJson: JSON.stringify(result.methodology),
            errorCode: null,
            analyzedAt: now,
            updatedAt: now,
          },
        })
        .run();
    });
    if (result.status === "ready") {
      const { recalculateActiveGoals } = await import("./training-goals");
      recalculateActiveGoals(metadata.userId);
    }
    return result.status;
  } catch (error) {
    const now = Date.now();
    database
      .insert(replayAnalyses)
      .values({ replayId, status: "failed", errorCode: errorCode(error), queuedAt: now, analyzedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: replayAnalyses.replayId,
        set: { status: "failed", errorCode: errorCode(error), analyzedAt: now, updatedAt: now },
      })
      .run();
    throw error;
  }
}

export function decisionAnalysisVisibleTo(role: "admin" | "user") {
  return role === "admin" || role === "user";
}

export function getReplayDecisionAnalysis(
  replay: ReplayMetadata,
  role: "admin" | "user",
): ReplayDecisionAnalysis {
  const database = getDb();
  const run = database
    .select({ run: replayAnalyses, model: analysisModelVersions })
    .from(replayAnalyses)
    .leftJoin(analysisModelVersions, eq(replayAnalyses.modelVersionId, analysisModelVersions.id))
    .where(eq(replayAnalyses.replayId, replay.id))
    .get();
  const visible = decisionAnalysisVisibleTo(role);

  if (!run) {
    return {
      status: "insufficient_data",
      observationCount: 0,
      analysisCount: 0,
      versions: null,
      summary: null,
      methodology: null,
      handAnalyses: [],
      recommendationsVisible: visible,
      shadowMode: !visible,
      reason: "historical_replay_without_decision_capture",
    };
  }

  const analyses = run.run.status === "ready"
    ? database
      .select({ analysisJson: handAnalyses.analysisJson })
      .from(handAnalyses)
      .where(eq(handAnalyses.replayId, replay.id))
      .orderBy(asc(handAnalyses.frameSequence), asc(handAnalyses.id))
      .all()
      .map(({ analysisJson }) => parseJson<HandAnalysis | null>(analysisJson, null))
      .filter((analysis): analysis is HandAnalysis => analysis !== null && analysis.confidence !== "low")
    : [];
  const versions = run.model ? {
    analysisSchema: run.model.analysisSchema,
    replaySchema: replay.schemaVersion,
    evaluator: run.model.evaluatorVersion,
    cardCatalog: run.model.cardCatalogVersion,
    rules: run.model.rulesVersion,
    talisharCommit: run.model.talisharCommit,
  } : null;

  return {
    status: run.run.status as AnalysisStatus,
    observationCount: run.run.observationCount,
    analysisCount: run.run.analysisCount,
    versions,
    summary: visible ? parseJson<AnalysisSummary | null>(run.run.summaryJson, null) : null,
    methodology: parseJson<ReplayDecisionAnalysis["methodology"]>(run.run.methodologyJson, null),
    handAnalyses: visible ? analyses : [],
    recommendationsVisible: visible,
    shadowMode: !visible,
    reason: run.run.errorCode ?? undefined,
    updatedAt: run.run.updatedAt,
  };
}

export function saveAnalysisFeedback(input: {
  replayId: number;
  userId: number;
  analysisFingerprint: string;
  helpful: boolean;
}): boolean {
  const validAnalysis = getDb()
    .select({ fingerprint: handAnalyses.stateFingerprint })
    .from(handAnalyses)
    .where(and(
      eq(handAnalyses.replayId, input.replayId),
      eq(handAnalyses.stateFingerprint, input.analysisFingerprint),
    ))
    .get();
  if (!validAnalysis) return false;
  const now = Date.now();
  getDb()
    .insert(analysisFeedback)
    .values({
      replayId: input.replayId,
      userId: input.userId,
      analysisFingerprint: input.analysisFingerprint,
      helpful: input.helpful,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [analysisFeedback.userId, analysisFeedback.replayId, analysisFeedback.analysisFingerprint],
      set: { helpful: input.helpful, updatedAt: now },
    })
    .run();
  return true;
}

export type DecisionAnalysisAggregate = {
  analyzedDecisions: number;
  averageHandPotential: number | null;
  averageExecutionQuality: number | null;
  varianceLimitedHands: number;
  executionBelowPotential: number;
  patterns: Array<{ tag: string; occurrences: number }>;
  deckSignals: Array<{
    tag: string;
    occurrences: number;
    averageRegretPp: number;
    confidenceIntervalExcludesNeutral: true;
  }>;
  byHeroMatchup: Array<{
    playerHeroId: string;
    opponentHeroId: string;
    decisions: number;
    averagePotential: number;
    averageExecution: number;
    averageRegretPp: number;
  }>;
};

export function aggregateDecisionAnalysis(
  userId: number,
  options: { startAt?: number | null; endAt?: number | null; mode?: string | null } = {},
): DecisionAnalysisAggregate {
  const conditions = [eq(replays.userId, userId), inArray(handAnalyses.confidence, ["high", "medium"] as const)];
  if (options.startAt !== null && options.startAt !== undefined) conditions.push(gte(replays.startedAt, options.startAt));
  if (options.endAt !== null && options.endAt !== undefined) conditions.push(lte(replays.startedAt, options.endAt));
  if (options.mode && options.mode !== "all") conditions.push(eq(replays.gameMode, options.mode));
  const rows = getDb()
    .select({ replay: replays, analysis: handAnalyses })
    .from(handAnalyses)
    .innerJoin(replays, eq(handAnalyses.replayId, replays.id))
    .where(and(...conditions))
    .all();
  const average = (values: number[]) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10
    : null;
  const patterns = new Map<string, number>();
  const patternRegrets = new Map<string, number[]>();
  const matchups = new Map<string, { playerHeroId: string; opponentHeroId: string; potential: number[]; execution: number[]; regret: number[] }>();
  for (const row of rows) {
    for (const tag of parseJson<string[]>(row.analysis.tagsJson, [])) {
      patterns.set(tag, (patterns.get(tag) ?? 0) + 1);
      patternRegrets.set(tag, [...(patternRegrets.get(tag) ?? []), row.analysis.regretPp]);
    }
    if (!row.replay.playerHeroId || !row.replay.opponentHeroId) continue;
    const key = `${row.replay.playerHeroId}:${row.replay.opponentHeroId}`;
    const bucket = matchups.get(key) ?? {
      playerHeroId: row.replay.playerHeroId,
      opponentHeroId: row.replay.opponentHeroId,
      potential: [],
      execution: [],
      regret: [],
    };
    bucket.potential.push(row.analysis.handPotential);
    bucket.execution.push(row.analysis.executionQuality);
    bucket.regret.push(row.analysis.regretPp);
    matchups.set(key, bucket);
  }
  return {
    analyzedDecisions: rows.length,
    averageHandPotential: average(rows.map((row) => row.analysis.handPotential)),
    averageExecutionQuality: average(rows.map((row) => row.analysis.executionQuality)),
    varianceLimitedHands: rows.filter((row) => row.analysis.handPotential < 45 && row.analysis.executionQuality >= 80).length,
    executionBelowPotential: rows.filter((row) => row.analysis.regretPp >= 2).length,
    patterns: [...patterns.entries()]
      .filter(([, occurrences]) => occurrences >= 2)
      .map(([tag, occurrences]) => ({ tag, occurrences }))
      .sort((left, right) => right.occurrences - left.occurrences)
      .slice(0, 3),
    deckSignals: [...patternRegrets.entries()]
      .filter(([, values]) => {
        if (values.length < 3) return false;
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
        return mean - 1.96 * Math.sqrt(variance / values.length) > 0;
      })
      .map(([tag, values]) => ({
        tag,
        occurrences: values.length,
        averageRegretPp: average(values) ?? 0,
        confidenceIntervalExcludesNeutral: true as const,
      }))
      .sort((left, right) => right.occurrences - left.occurrences)
      .slice(0, 3),
    byHeroMatchup: [...matchups.values()].map((bucket) => ({
      playerHeroId: bucket.playerHeroId,
      opponentHeroId: bucket.opponentHeroId,
      decisions: bucket.potential.length,
      averagePotential: average(bucket.potential) ?? 0,
      averageExecution: average(bucket.execution) ?? 0,
      averageRegretPp: average(bucket.regret) ?? 0,
    })).sort((left, right) => right.decisions - left.decisions),
  };
}

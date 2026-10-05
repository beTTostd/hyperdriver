import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import { decisionObservations, handAnalyses, replayAnalyses, replays, trainingExerciseAttempts } from "../db/schema";
import { CURRENT_DECISION_MODEL_ID } from "./decision-analysis";
import { buildPracticeExercises, gradePracticeExercise } from "./decision-practice-core.js";

function sourceExercises(userId: number) {
  const database = getDb();
  const recent = database.select({ id: replays.id }).from(replays)
    .innerJoin(replayAnalyses, eq(replayAnalyses.replayId, replays.id))
    .where(and(eq(replays.userId, userId), ne(replays.participation, "watched"), eq(replayAnalyses.status, "ready"),
      eq(replayAnalyses.modelVersionId, CURRENT_DECISION_MODEL_ID)))
    .orderBy(desc(replays.startedAt), desc(replays.id)).limit(50).all();
  if (!recent.length) return buildPracticeExercises([], CURRENT_DECISION_MODEL_ID);
  const rows = database.select({ analysis: handAnalyses.analysisJson, state: decisionObservations.stateJson,
    quality: decisionObservations.dataQuality, actions: decisionObservations.legalActionsJson,
    handFingerprint: decisionObservations.handFingerprint, kind: decisionObservations.kind,
    turn: decisionObservations.turn, replayId: replays.id, sourceMatchId: replays.sourceMatchId, startedAt: replays.startedAt })
    .from(handAnalyses).innerJoin(decisionObservations, eq(handAnalyses.observationId, decisionObservations.id))
    .innerJoin(replays, eq(handAnalyses.replayId, replays.id))
    .where(and(eq(replays.userId, userId), inArray(replays.id, recent.map((row) => row.id)),
      eq(handAnalyses.modelVersionId, CURRENT_DECISION_MODEL_ID), eq(handAnalyses.scoreUnit, "heuristic_points"),
      eq(decisionObservations.modelVersionId, CURRENT_DECISION_MODEL_ID)))
    .orderBy(desc(replays.startedAt), desc(handAnalyses.id)).limit(2000).all();
  return buildPracticeExercises(rows.flatMap((row) => {
    try {
      const analysis = JSON.parse(row.analysis);
      return [{ replayId: row.replayId, sourceMatchId: row.sourceMatchId, startedAt: row.startedAt, analysis,
        observation: { state: JSON.parse(row.state), legalActions: JSON.parse(row.actions), dataQuality: row.quality,
          stateFingerprint: analysis.stateFingerprint, handFingerprint: row.handFingerprint, kind: row.kind, turn: row.turn } }];
    } catch { return []; }
  }), CURRENT_DECISION_MODEL_ID);
}

export function listPracticeExercises(userId: number) {
  const source = sourceExercises(userId);
  const attempts = getDb().select().from(trainingExerciseAttempts).where(and(eq(trainingExerciseAttempts.userId, userId),
    eq(trainingExerciseAttempts.modelVersionId, CURRENT_DECISION_MODEL_ID))).all();
  const exercises = source.exercises.map(({ exercise }) => {
    const attempt = attempts.find((row) => row.exerciseKey === exercise.id);
    return { ...exercise, practiced: Boolean(attempt), attempts: attempt?.attempts ?? 0 };
  }).sort((a, b) => Number(a.practiced) - Number(b.practiced));
  return { exercises, modelVersionId: CURRENT_DECISION_MODEL_ID, evaluatedMatches: source.evaluatedMatches,
    evaluatedOpportunities: source.evaluatedOpportunities, practiced: exercises.filter((exercise) => exercise.practiced).length };
}

export function submitPracticeAttempt(userId: number, exerciseId: string, actionKey: string, helpful?: boolean) {
  const item = sourceExercises(userId).exercises.find(({ exercise }) => exercise.id === exerciseId);
  if (!item) return null;
  const result = gradePracticeExercise(item, actionKey);
  if (!result) return null;
  const now = Date.now();
  getDb().insert(trainingExerciseAttempts).values({ userId, replayId: item.exercise.replayId, exerciseKey: exerciseId,
    modelVersionId: CURRENT_DECISION_MODEL_ID, chosenActionKey: actionKey, withinTolerance: result.withinTolerance,
    scoreGap: result.scoreGap, helpful: helpful ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [trainingExerciseAttempts.userId, trainingExerciseAttempts.exerciseKey], set: {
      chosenActionKey: actionKey, withinTolerance: result.withinTolerance, scoreGap: result.scoreGap,
      attempts: sql`${trainingExerciseAttempts.attempts} + 1`, updatedAt: now,
      ...(helpful === undefined ? {} : { helpful }),
    } }).run();
  return result;
}

export function savePracticeHelpfulness(userId: number, exerciseId: string, helpful: boolean) {
  if (!sourceExercises(userId).exercises.some(({ exercise }) => exercise.id === exerciseId)) return false;
  return getDb().update(trainingExerciseAttempts).set({ helpful, updatedAt: Date.now() })
    .where(and(eq(trainingExerciseAttempts.userId, userId), eq(trainingExerciseAttempts.exerciseKey, exerciseId),
      eq(trainingExerciseAttempts.modelVersionId, CURRENT_DECISION_MODEL_ID))).returning({ id: trainingExerciseAttempts.id }).get() !== undefined;
}

export type PracticeExercise = ReturnType<typeof listPracticeExercises>["exercises"][number];
export type PracticeResult = NonNullable<ReturnType<typeof submitPracticeAttempt>>;

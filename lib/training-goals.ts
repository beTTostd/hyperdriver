import { and, asc, desc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { getDb } from "../db";
import {
  handAnalyses,
  replayAnalyses,
  replays,
  trainingGoalCheckins,
  trainingGoals,
} from "../db/schema";
import { findUserReplay } from "./replays";
import { automaticGoalResult } from "./training-goals-core.js";

export class GoalError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function textValue(value: unknown, max: number, label: string, required = true) {
  if (typeof value !== "string" || (required && !value.trim()) || value.trim().length > max) throw new GoalError(`${label} inválido.`);
  return value.trim();
}

function targetValue(value: unknown) {
  const target = Number(value ?? 10);
  if (!Number.isInteger(target) || target < 1 || target > 50) throw new GoalError("O alvo deve ter entre 1 e 50 partidas.");
  return target;
}

function tags(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []; } catch { return []; }
}

function analyzedReplayRows(userId: number, options: { before?: number; after?: number; gameMode?: string | null; heroId?: string | null }) {
  const conditions = [eq(replays.userId, userId), eq(replayAnalyses.status, "ready")];
  if (options.before !== undefined) conditions.push(lte(replays.startedAt, options.before));
  if (options.after !== undefined) conditions.push(gt(replays.startedAt, options.after));
  if (options.gameMode) conditions.push(eq(replays.gameMode, options.gameMode));
  if (options.heroId) conditions.push(eq(replays.playerHeroId, options.heroId));
  return getDb().select({ replay: replays }).from(replays).innerJoin(replayAnalyses, eq(replayAnalyses.replayId, replays.id)).where(and(...conditions)).orderBy(desc(replays.startedAt), desc(replays.id)).all().map((row) => row.replay);
}

function patternMetrics(replayIds: number[], patternTag: string) {
  if (!replayIds.length) return { eligibleReplayIds: [] as number[], occurrences: 0, decisions: 0, rate: 0 };
  const rows = getDb().select({ replayId: handAnalyses.replayId, confidence: handAnalyses.confidence, tagsJson: handAnalyses.tagsJson }).from(handAnalyses).where(inArray(handAnalyses.replayId, replayIds)).all().filter((row) => row.confidence !== "low");
  const eligibleReplayIds = [...new Set(rows.map((row) => row.replayId))];
  const occurrences = rows.filter((row) => tags(row.tagsJson).includes(patternTag)).length;
  return { eligibleReplayIds, occurrences, decisions: rows.length, rate: rows.length ? occurrences * 100 / rows.length : 0 };
}

function baseline(userId: number, replayId: number, patternTag: string, gameMode: string | null, heroId: string | null) {
  const source = findUserReplay(userId, String(replayId));
  if (!source) throw new GoalError("Replay de origem não encontrado.", 404);
  const candidates = analyzedReplayRows(userId, { before: source.startedAt, gameMode, heroId }).filter((replay) => replay.id !== source.id);
  const eligibleIds: number[] = [];
  for (const replay of candidates) {
    if (patternMetrics([replay.id], patternTag).decisions > 0) eligibleIds.push(replay.id);
    if (eligibleIds.length === 10) break;
  }
  const metrics = patternMetrics(eligibleIds, patternTag);
  if (metrics.eligibleReplayIds.length < 5) throw new GoalError("São necessários ao menos 5 replays analisados anteriores no mesmo escopo.", 422);
  return { ...metrics, replayCount: metrics.eligibleReplayIds.length };
}

export function createGoal(userId: number, input: Record<string, unknown>) {
  const origin = input.origin === "analysis_pattern" ? "analysis_pattern" : "manual";
  const title = textValue(input.title, 160, "Título");
  const description = input.description === undefined ? "" : textValue(input.description, 2000, "Descrição", false);
  let gameMode = typeof input.gameMode === "string" && input.gameMode.trim() ? input.gameMode.trim().toLowerCase() : null;
  let heroId = typeof input.heroId === "string" && input.heroId.trim() ? input.heroId.trim() : null;
  const targetMatches = origin === "analysis_pattern" ? 10 : targetValue(input.targetMatches);
  let sourceReplayId: number | null = null;
  let patternTag: string | null = null;
  let frozen: ReturnType<typeof baseline> | null = null;
  if (origin === "analysis_pattern") {
    const source = findUserReplay(userId, String(input.sourceReplayId ?? ""));
    if (!source) throw new GoalError("Replay de origem não encontrado.", 404);
    sourceReplayId = source.id;
    gameMode ??= source.gameMode;
    heroId ??= source.playerHeroId;
    patternTag = textValue(input.patternTag, 80, "Padrão");
    frozen = baseline(userId, source.id, patternTag, gameMode, heroId);
  }
  const now = Date.now();
  return getDb().insert(trainingGoals).values({
    userId, title, description, origin, gameMode, heroId, targetMatches,
    sourceReplayId, patternTag,
    baselineReplayCount: frozen?.replayCount ?? null,
    baselineOccurrences: frozen?.occurrences ?? null,
    baselineDecisions: frozen?.decisions ?? null,
    baselineRate: frozen?.rate ?? null,
    targetRate: frozen ? frozen.rate * 0.75 : null,
    currentOccurrences: origin === "analysis_pattern" ? 0 : null,
    currentDecisions: origin === "analysis_pattern" ? 0 : null,
    currentRate: origin === "analysis_pattern" ? 0 : null,
    startedAt: now, createdAt: now, updatedAt: now,
  }).returning().get();
}

export function recalculateActiveGoals(userId: number) {
  const active = getDb().select().from(trainingGoals).where(and(eq(trainingGoals.userId, userId), eq(trainingGoals.status, "active"), eq(trainingGoals.origin, "analysis_pattern"), isNotNull(trainingGoals.patternTag))).all();
  for (const goal of active) {
    const candidates = analyzedReplayRows(userId, { after: goal.startedAt, gameMode: goal.gameMode, heroId: goal.heroId }).reverse();
    const firstEligible: number[] = [];
    for (const replay of candidates) {
      if (patternMetrics([replay.id], goal.patternTag!).decisions > 0) firstEligible.push(replay.id);
      if (firstEligible.length >= goal.targetMatches) break;
    }
    const metrics = patternMetrics(firstEligible, goal.patternTag!);
    const automaticResult = automaticGoalResult({ baselineRate: goal.baselineRate, currentRate: metrics.rate, progressMatches: firstEligible.length, targetMatches: goal.targetMatches });
    const reduction = automaticResult.reduction;
    const finished = automaticResult.complete;
    const achieved = metrics.decisions > 0 && automaticResult.achieved;
    getDb().update(trainingGoals).set({
      progressMatches: firstEligible.length,
      currentOccurrences: metrics.occurrences,
      currentDecisions: metrics.decisions,
      currentRate: metrics.rate,
      resultReduction: finished ? reduction : null,
      status: finished ? achieved ? "achieved" : "not_achieved" : "active",
      completedAt: finished ? Date.now() : null,
      updatedAt: Date.now(),
    }).where(and(eq(trainingGoals.id, goal.id), eq(trainingGoals.status, "active"))).run();
  }
}

export function listGoals(userId: number) {
  recalculateActiveGoals(userId);
  const goals = getDb().select().from(trainingGoals).where(eq(trainingGoals.userId, userId)).orderBy(asc(trainingGoals.status), desc(trainingGoals.createdAt)).all();
  const checkins = goals.length ? getDb().select().from(trainingGoalCheckins).where(inArray(trainingGoalCheckins.goalId, goals.map((goal) => goal.id))).orderBy(desc(trainingGoalCheckins.createdAt)).all() : [];
  return goals.map((goal) => ({ ...goal, checkins: checkins.filter((checkin) => checkin.goalId === goal.id) }));
}

export function getGoal(userId: number, goalId: number) {
  return getDb().select().from(trainingGoals).where(and(eq(trainingGoals.id, goalId), eq(trainingGoals.userId, userId))).get() ?? null;
}

export function updateGoal(userId: number, goalId: number, input: Record<string, unknown>) {
  const goal = getGoal(userId, goalId);
  if (!goal) return null;
  const allowedStatuses = goal.origin === "manual" ? ["active", "achieved", "not_achieved", "cancelled"] : ["active", "cancelled"];
  const status = input.status === undefined ? goal.status : String(input.status);
  if (!allowedStatuses.includes(status)) throw new GoalError("Estado inválido para esta meta.");
  const targetMatches = input.targetMatches === undefined || goal.origin !== "manual" ? goal.targetMatches : targetValue(input.targetMatches);
  return getDb().update(trainingGoals).set({
    title: input.title === undefined ? goal.title : textValue(input.title, 160, "Título"),
    description: input.description === undefined ? goal.description : textValue(input.description, 2000, "Descrição", false),
    targetMatches,
    status: status as typeof goal.status,
    completedAt: status === "active" ? null : goal.completedAt ?? Date.now(),
    updatedAt: Date.now(),
  }).where(and(eq(trainingGoals.id, goalId), eq(trainingGoals.userId, userId))).returning().get();
}

export function addGoalCheckin(userId: number, goalId: number, input: Record<string, unknown>) {
  const goal = getGoal(userId, goalId);
  if (!goal || goal.origin !== "manual" || goal.status !== "active") return null;
  const replay = findUserReplay(userId, String(input.replayId ?? ""));
  if (!replay || replay.startedAt <= goal.startedAt) throw new GoalError("O check-in precisa usar um replay posterior à criação da meta.", 422);
  const state = input.state === "met" || input.state === "not_met" ? input.state : null;
  if (!state) throw new GoalError("Resultado do check-in inválido.");
  const note = input.note === undefined ? "" : textValue(input.note, 1000, "Nota", false);
  const result = getDb().insert(trainingGoalCheckins).values({ goalId, replayId: replay.id, state, note, createdAt: Date.now() }).onConflictDoUpdate({ target: [trainingGoalCheckins.goalId, trainingGoalCheckins.replayId], set: { state, note, createdAt: Date.now() } }).returning().get();
  const progress = getDb().select({ id: trainingGoalCheckins.id }).from(trainingGoalCheckins).where(eq(trainingGoalCheckins.goalId, goalId)).all().length;
  getDb().update(trainingGoals).set({ progressMatches: Math.min(progress, goal.targetMatches), updatedAt: Date.now() }).where(eq(trainingGoals.id, goalId)).run();
  return result;
}

export function deleteGoalCheckin(userId: number, goalId: number, checkinId: number) {
  const goal = getGoal(userId, goalId);
  if (!goal || goal.status !== "active" || goal.origin !== "manual") return false;
  const deleted = getDb().delete(trainingGoalCheckins).where(and(eq(trainingGoalCheckins.id, checkinId), eq(trainingGoalCheckins.goalId, goalId))).run().changes > 0;
  if (deleted) {
    const progress = getDb().select({ id: trainingGoalCheckins.id }).from(trainingGoalCheckins).where(eq(trainingGoalCheckins.goalId, goalId)).all().length;
    getDb().update(trainingGoals).set({ progressMatches: progress, updatedAt: Date.now() }).where(eq(trainingGoals.id, goalId)).run();
  }
  return deleted;
}

export function goalSuggestions(userId: number) {
  const recent = analyzedReplayRows(userId, {}).slice(0, 10);
  const rows = recent.length ? getDb().select({ replayId: handAnalyses.replayId, confidence: handAnalyses.confidence, tagsJson: handAnalyses.tagsJson }).from(handAnalyses).where(inArray(handAnalyses.replayId, recent.map((replay) => replay.id))).all() : [];
  const counts = new Map<string, number>();
  for (const row of rows) if (row.confidence !== "low") for (const tag of tags(row.tagsJson)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([patternTag, occurrences]) => ({ patternTag, occurrences }));
}

export function activeGoalSummary(userId: number) {
  return listGoals(userId).filter((goal) => goal.status === "active").map((goal) => ({ id: goal.id, title: goal.title, progressMatches: goal.progressMatches, targetMatches: goal.targetMatches }));
}

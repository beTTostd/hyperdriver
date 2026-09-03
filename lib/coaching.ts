import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  coachingMessages,
  coachingThreads,
  replayBookmarks,
  replayShares,
  replayWorkspace,
  trainingGoals,
} from "../db/schema";
import { hashToken } from "./auth";
import { getReplayDecisionAnalysis } from "./decision-analysis";
import { findUserReplay, readUserReplay } from "./replays";

export const COACH_TOKEN_HEADER = "x-hyperdriver-coach-token";
const durationMs = { 1: 24 * 60 * 60 * 1000, 7: 7 * 24 * 60 * 60 * 1000, 30: 30 * 24 * 60 * 60 * 1000 } as const;

export class CoachingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function requiredText(value: unknown, maximum: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new CoachingError(`${label} inválido.`);
  return value.trim();
}

function permissions(input: Record<string, unknown>) {
  const keys = ["includeAnalysis", "includeNote", "includeBookmarks", "includeGoals"] as const;
  return Object.fromEntries(keys.map((key) => {
    const value = input[key] ?? false;
    if (typeof value !== "boolean") throw new CoachingError("Permissões inválidas.");
    return [key, value];
  })) as Record<(typeof keys)[number], boolean>;
}

export function listReplayShares(userId: number, replayId: string) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  const shares = getDb().select({
    id: replayShares.id,
    coachName: replayShares.coachName,
    expiresAt: replayShares.expiresAt,
    revokedAt: replayShares.revokedAt,
    includeAnalysis: replayShares.includeAnalysis,
    includeNote: replayShares.includeNote,
    includeBookmarks: replayShares.includeBookmarks,
    includeGoals: replayShares.includeGoals,
    createdAt: replayShares.createdAt,
  }).from(replayShares).where(and(eq(replayShares.replayId, replay.id), eq(replayShares.userId, userId))).orderBy(desc(replayShares.createdAt)).all();
  return shares.map((share) => ({ ...share, threads: listShareThreads(share.id) }));
}

export function createReplayShare(userId: number, replayId: string, input: Record<string, unknown>) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  const active = getDb().select({ value: count() }).from(replayShares).where(and(
    eq(replayShares.replayId, replay.id), isNull(replayShares.revokedAt), gt(replayShares.expiresAt, Date.now()),
  )).get()?.value ?? 0;
  if (active >= 10) throw new CoachingError("Este replay já possui 10 links ativos.", 409);
  const days = Number(input.durationDays ?? 7) as keyof typeof durationMs;
  if (!(days in durationMs)) throw new CoachingError("Validade inválida.");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const now = Date.now();
  const allowed = permissions(input);
  const share = getDb().insert(replayShares).values({
    id,
    replayId: replay.id,
    userId,
    tokenHash: hashToken(token),
    coachName: requiredText(input.coachName, 80, "Nome do treinador"),
    expiresAt: now + durationMs[days],
    ...allowed,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: replayShares.id, coachName: replayShares.coachName, expiresAt: replayShares.expiresAt, ...{
    includeAnalysis: replayShares.includeAnalysis,
    includeNote: replayShares.includeNote,
    includeBookmarks: replayShares.includeBookmarks,
    includeGoals: replayShares.includeGoals,
  } }).get();
  return { ...share, url: `/coach/${id}#token=${token}` };
}

export function changeReplayShare(userId: number, replayId: string, shareId: string, input: Record<string, unknown>) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  const existing = ownerShare(userId, replay.id, shareId);
  if (!existing) return null;
  const allowed = permissions({
    includeAnalysis: input.includeAnalysis ?? existing.includeAnalysis,
    includeNote: input.includeNote ?? existing.includeNote,
    includeBookmarks: input.includeBookmarks ?? existing.includeBookmarks,
    includeGoals: input.includeGoals ?? existing.includeGoals,
  });
  const revokedAt = input.revoked === undefined ? existing.revokedAt : input.revoked === true ? Date.now() : null;
  if (input.revoked !== undefined && typeof input.revoked !== "boolean") throw new CoachingError("Revogação inválida.");
  return getDb().update(replayShares).set({ ...allowed, revokedAt, updatedAt: Date.now() }).where(eq(replayShares.id, shareId)).returning({
    id: replayShares.id,
    coachName: replayShares.coachName,
    expiresAt: replayShares.expiresAt,
    revokedAt: replayShares.revokedAt,
    includeAnalysis: replayShares.includeAnalysis,
    includeNote: replayShares.includeNote,
    includeBookmarks: replayShares.includeBookmarks,
    includeGoals: replayShares.includeGoals,
    updatedAt: replayShares.updatedAt,
  }).get();
}

export function deleteReplayShare(userId: number, replayId: string, shareId: string) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return false;
  return getDb().delete(replayShares).where(and(eq(replayShares.id, shareId), eq(replayShares.replayId, replay.id), eq(replayShares.userId, userId))).run().changes > 0;
}

function ownerShare(userId: number, replayId: number, shareId: string) {
  return getDb().select().from(replayShares).where(and(eq(replayShares.id, shareId), eq(replayShares.replayId, replayId), eq(replayShares.userId, userId))).get() ?? null;
}

export function authorizeCoachShare(shareId: string, token: string | null) {
  if (!token || token.length > 128) return null;
  return getDb().select().from(replayShares).where(and(
    eq(replayShares.id, shareId),
    eq(replayShares.tokenHash, hashToken(token)),
    isNull(replayShares.revokedAt),
    gt(replayShares.expiresAt, Date.now()),
  )).get() ?? null;
}

export function publicShareData(share: typeof replayShares.$inferSelect) {
  const workspace = getDb().select().from(replayWorkspace).where(eq(replayWorkspace.replayId, share.replayId)).get();
  const bookmarks = share.includeBookmarks ? getDb().select({ id: replayBookmarks.id, frameIndex: replayBookmarks.frameIndex, title: replayBookmarks.title, note: replayBookmarks.note }).from(replayBookmarks).where(eq(replayBookmarks.replayId, share.replayId)).orderBy(asc(replayBookmarks.frameIndex)).all() : undefined;
  const goals = share.includeGoals ? getDb().select({ id: trainingGoals.id, title: trainingGoals.title, description: trainingGoals.description, status: trainingGoals.status, progressMatches: trainingGoals.progressMatches, targetMatches: trainingGoals.targetMatches }).from(trainingGoals).where(and(eq(trainingGoals.userId, share.userId), eq(trainingGoals.status, "active"))).all() : undefined;
  const replay = findUserReplay(share.userId, String(share.replayId))!;
  return {
    id: share.id,
    coachName: share.coachName,
    expiresAt: share.expiresAt,
    permissions: { analysis: share.includeAnalysis, note: share.includeNote, bookmarks: share.includeBookmarks, goals: share.includeGoals },
    replay: { frameCount: replay.frameCount, startedAt: replay.startedAt, result: replay.result, gameMode: replay.gameMode, playerHeroId: replay.playerHeroId, opponentHeroId: replay.opponentHeroId },
    note: share.includeNote ? workspace?.note ?? "" : undefined,
    bookmarks,
    goals,
    analysis: share.includeAnalysis ? getReplayDecisionAnalysis(replay, "admin") : undefined,
    threads: listShareThreads(share.id),
  };
}

export async function publicReplayData(share: typeof replayShares.$inferSelect) {
  const stored = await readUserReplay(share.userId, String(share.replayId));
  if (!stored) return null;
  return scrubReplaySecrets(JSON.parse(stored.raw));
}

function scrubReplaySecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubReplaySecrets);
  if (!value || typeof value !== "object") return value;
  const forbidden = new Set(["deckLink", "username", "playerName", "opponentName"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.has(key)).map(([key, entry]) => [key, scrubReplaySecrets(entry)]));
}

export function listShareThreads(shareId: string) {
  const threads = getDb().select().from(coachingThreads).where(eq(coachingThreads.shareId, shareId)).orderBy(asc(coachingThreads.frameIndex), asc(coachingThreads.id)).all();
  const messages = threads.length ? getDb().select().from(coachingMessages).where(inArray(coachingMessages.threadId, threads.map((thread) => thread.id))).orderBy(asc(coachingMessages.createdAt)).all() : [];
  return threads.map((thread) => ({
    ...thread,
    messages: messages.filter((message) => message.threadId === thread.id),
  }));
}

export function createCoachThread(share: typeof replayShares.$inferSelect, input: Record<string, unknown>) {
  const replay = findUserReplay(share.userId, String(share.replayId))!;
  const frameIndex = Number(input.frameIndex);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= replay.frameCount) throw new CoachingError("Frame fora do replay.");
  const body = requiredText(input.body, 2000, "Comentário");
  const now = Date.now();
  return getDb().transaction((transaction) => {
    const thread = transaction.insert(coachingThreads).values({ shareId: share.id, replayId: share.replayId, frameIndex, title: typeof input.title === "string" ? input.title.trim().slice(0, 120) || null : null, createdAt: now, updatedAt: now }).returning().get();
    transaction.insert(coachingMessages).values({ threadId: thread.id, authorRole: "coach", body, createdAt: now }).run();
    return { ...thread, messages: transaction.select().from(coachingMessages).where(eq(coachingMessages.threadId, thread.id)).all() };
  });
}

export function addCoachMessage(share: typeof replayShares.$inferSelect, threadId: number, bodyValue: unknown, authorRole: "coach" | "player") {
  const thread = getDb().select().from(coachingThreads).where(and(eq(coachingThreads.id, threadId), eq(coachingThreads.shareId, share.id), eq(coachingThreads.replayId, share.replayId))).get();
  if (!thread) return null;
  const message = getDb().insert(coachingMessages).values({ threadId, authorRole, body: requiredText(bodyValue, 2000, "Comentário"), createdAt: Date.now() }).returning().get();
  getDb().update(coachingThreads).set({ updatedAt: Date.now() }).where(eq(coachingThreads.id, threadId)).run();
  return message;
}

export function ownerAddMessage(userId: number, replayId: string, threadId: number, body: unknown) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  const thread = getDb().select().from(coachingThreads).where(and(eq(coachingThreads.id, threadId), eq(coachingThreads.replayId, replay.id))).get();
  if (!thread) return null;
  const share = ownerShare(userId, replay.id, thread.shareId);
  return share ? addCoachMessage(share, threadId, body, "player") : null;
}

export function ownerChangeThread(userId: number, replayId: string, threadId: number, resolved: unknown) {
  const replay = findUserReplay(userId, replayId);
  if (!replay || typeof resolved !== "boolean") return null;
  return getDb().update(coachingThreads).set({ resolvedAt: resolved ? Date.now() : null, updatedAt: Date.now() }).where(and(eq(coachingThreads.id, threadId), eq(coachingThreads.replayId, replay.id))).returning().get() ?? null;
}

import { and, asc, count, eq, inArray, notInArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  replayBookmarks,
  replayTags,
  replayWorkspace,
  userTags,
} from "../db/schema";
import { findUserReplay } from "./replays";

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Workspace = {
  note: string;
  isFavorite: boolean;
  reviewedAt: number | null;
  tags: Array<{ id: number; name: string }>;
  bookmarks: Array<typeof replayBookmarks.$inferSelect>;
};

function cleanText(value: unknown, maximum: number, field: string, optional = false) {
  if (value === null && optional) return null;
  if (typeof value !== "string") throw new WorkspaceError(`${field} inválido.`);
  const cleaned = value.trim();
  if ((!optional && !cleaned) || cleaned.length > maximum) {
    throw new WorkspaceError(`${field} deve ter no máximo ${maximum} caracteres.`);
  }
  return cleaned || null;
}

function normalizeTag(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function getReplayWorkspace(userId: number, replayId: string | number): Workspace | null {
  const replay = findUserReplay(userId, String(replayId));
  if (!replay) return null;
  const database = getDb();
  const workspace = database.select().from(replayWorkspace).where(and(
    eq(replayWorkspace.replayId, replay.id),
    eq(replayWorkspace.userId, userId),
  )).get();
  const tags = database
    .select({ id: userTags.id, name: userTags.name })
    .from(replayTags)
    .innerJoin(userTags, eq(userTags.id, replayTags.tagId))
    .where(eq(replayTags.replayId, replay.id))
    .orderBy(asc(userTags.name))
    .all();
  const bookmarks = database.select().from(replayBookmarks).where(and(
    eq(replayBookmarks.replayId, replay.id),
    eq(replayBookmarks.userId, userId),
  )).orderBy(asc(replayBookmarks.frameIndex), asc(replayBookmarks.id)).all();
  return {
    note: workspace?.note ?? "",
    isFavorite: workspace?.isFavorite ?? false,
    reviewedAt: workspace?.reviewedAt ?? null,
    tags,
    bookmarks,
  };
}

export function updateReplayWorkspace(
  userId: number,
  replayId: string,
  input: { note?: unknown; isFavorite?: unknown; reviewed?: unknown; tags?: unknown },
): Workspace | null {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  const current = getReplayWorkspace(userId, replay.id)!;
  const note = input.note === undefined ? current.note : cleanText(input.note, 5000, "Nota", true) ?? "";
  const isFavorite = input.isFavorite === undefined ? current.isFavorite : input.isFavorite;
  if (typeof isFavorite !== "boolean") throw new WorkspaceError("Favorito inválido.");
  let reviewedAt = current.reviewedAt;
  if (input.reviewed !== undefined) {
    if (typeof input.reviewed !== "boolean") throw new WorkspaceError("Revisão inválida.");
    reviewedAt = input.reviewed ? Date.now() : null;
  }
  let requestedTags: string[] | null = null;
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some((tag) => typeof tag !== "string")) {
      throw new WorkspaceError("Use no máximo 10 tags por replay.");
    }
    requestedTags = [...new Map(input.tags.map((tag) => [normalizeTag(tag as string), (tag as string).normalize("NFKC").trim().replace(/\s+/g, " ")])).values()];
    if (requestedTags.some((tag) => !tag || tag.length > 24)) throw new WorkspaceError("Cada tag deve ter entre 1 e 24 caracteres.");
  }
  const database = getDb();
  const now = Date.now();
  database.transaction((transaction) => {
    transaction.insert(replayWorkspace).values({
      replayId: replay.id,
      userId,
      note,
      isFavorite,
      reviewedAt,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: replayWorkspace.replayId,
      set: { note, isFavorite, reviewedAt, updatedAt: now },
    }).run();
    if (requestedTags) {
      transaction.delete(replayTags).where(eq(replayTags.replayId, replay.id)).run();
      for (const name of requestedTags) {
        const normalizedName = normalizeTag(name);
        transaction.insert(userTags).values({ userId, name, normalizedName }).onConflictDoNothing().run();
        const tag = transaction.select({ id: userTags.id }).from(userTags).where(and(
          eq(userTags.userId, userId),
          eq(userTags.normalizedName, normalizedName),
        )).get()!;
        transaction.insert(replayTags).values({ replayId: replay.id, tagId: tag.id }).onConflictDoNothing().run();
      }
    }
  });
  cleanupUnusedTags(userId);
  return getReplayWorkspace(userId, replay.id);
}

function cleanupUnusedTags(userId: number) {
  const database = getDb();
  const ids = database.select({ id: replayTags.tagId }).from(replayTags).all().map((row) => row.id);
  if (!ids.length) database.delete(userTags).where(eq(userTags.userId, userId)).run();
  else database.delete(userTags).where(and(eq(userTags.userId, userId), notInArray(userTags.id, ids))).run();
}

export function createBookmark(userId: number, replayId: string, input: Record<string, unknown>) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  if (!Number.isInteger(input.frameIndex) || Number(input.frameIndex) < 0 || Number(input.frameIndex) >= replay.frameCount) {
    throw new WorkspaceError("Frame fora do replay.");
  }
  const existing = getDb().select({ value: count() }).from(replayBookmarks).where(eq(replayBookmarks.replayId, replay.id)).get()?.value ?? 0;
  if (existing >= 100) throw new WorkspaceError("Este replay já atingiu o limite de 100 bookmarks.", 409);
  const now = Date.now();
  return getDb().insert(replayBookmarks).values({
    replayId: replay.id,
    userId,
    frameIndex: Number(input.frameIndex),
    title: cleanText(input.title, 120, "Título")!,
    note: cleanText(input.note ?? null, 1000, "Nota", true),
    createdAt: now,
    updatedAt: now,
  }).returning().get();
}

export function updateBookmark(userId: number, replayId: string, bookmarkId: number, input: Record<string, unknown>) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  const existing = getDb().select().from(replayBookmarks).where(and(
    eq(replayBookmarks.id, bookmarkId), eq(replayBookmarks.replayId, replay.id), eq(replayBookmarks.userId, userId),
  )).get();
  if (!existing) return null;
  const frameIndex = input.frameIndex === undefined ? existing.frameIndex : Number(input.frameIndex);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= replay.frameCount) throw new WorkspaceError("Frame fora do replay.");
  return getDb().update(replayBookmarks).set({
    frameIndex,
    title: input.title === undefined ? existing.title : cleanText(input.title, 120, "Título")!,
    note: input.note === undefined ? existing.note : cleanText(input.note, 1000, "Nota", true),
    updatedAt: Date.now(),
  }).where(eq(replayBookmarks.id, existing.id)).returning().get();
}

export function deleteBookmark(userId: number, replayId: string, bookmarkId: number) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return false;
  return getDb().delete(replayBookmarks).where(and(
    eq(replayBookmarks.id, bookmarkId), eq(replayBookmarks.replayId, replay.id), eq(replayBookmarks.userId, userId),
  )).run().changes > 0;
}

export function listUserTags(userId: number) {
  return getDb().select({ id: userTags.id, name: userTags.name }).from(userTags).where(eq(userTags.userId, userId)).orderBy(asc(userTags.name)).all();
}

export function workspaceSummaries(userId: number, replayIds: number[]) {
  if (!replayIds.length) return new Map<number, { isFavorite: boolean; reviewedAt: number | null; hasNote: boolean; tags: string[] }>();
  const workspaces = getDb().select().from(replayWorkspace).where(and(eq(replayWorkspace.userId, userId), inArray(replayWorkspace.replayId, replayIds))).all();
  const tags = getDb().select({ replayId: replayTags.replayId, name: userTags.name }).from(replayTags).innerJoin(userTags, eq(userTags.id, replayTags.tagId)).where(inArray(replayTags.replayId, replayIds)).all();
  return new Map(replayIds.map((id) => {
    const workspace = workspaces.find((item) => item.replayId === id);
    return [id, { isFavorite: workspace?.isFavorite ?? false, reviewedAt: workspace?.reviewedAt ?? null, hasNote: Boolean(workspace?.note), tags: tags.filter((tag) => tag.replayId === id).map((tag) => tag.name) }];
  }));
}

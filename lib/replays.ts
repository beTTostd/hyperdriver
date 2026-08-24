import { randomUUID } from "node:crypto";
import { and, count, desc, eq, lt, or, sum } from "drizzle-orm";
import { getDb } from "../db";
import { replayMetrics, replays, users } from "../db/schema";
import { compactReplayDocument, replayResult } from "../talishar-local-history/replay-state.js";
import { calculateReplayTelemetry } from "./replay-telemetry";
import { getReplayStorage, type QuarantinedReplay } from "./replay-storage";

export const MAX_REPLAY_BYTES = 50 * 1024 * 1024;
export const REPLAY_PAGE_SIZE = 25;
const MAX_REPLAY_FRAMES = 20_000;
const MAX_COLLECTION_LENGTH = 50_000;
const MAX_STRING_LENGTH = 1024 * 1024;
const MAX_DOCUMENT_DEPTH = 40;
const MAX_OBJECT_KEYS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReplayCard = {
  cardNumber?: string;
  slot?: string;
  controller?: string | number;
  counters?: string | number;
  countersMap?: Record<string, string | number>;
  isBroken?: boolean;
  onChain?: boolean;
};

export type ReplayChain = {
  attackingCard?: ReplayCard;
  totalPower?: string | number;
  totalDefense?: string | number;
  reactions?: ReplayCard[];
};

export type ReplayPayload = {
  turnNo?: string | number;
  turnPlayer?: string | number;
  otherPlayer?: string | number;
  turnPhase?: { turnPhase?: string };
  playerHealth?: string | number;
  opponentHealth?: string | number;
  playerEquipment?: ReplayCard[];
  opponentEquipment?: ReplayCard[];
  activeChainLink?: ReplayChain | null;
  initialLoad?: { gameFormat?: string; deckLink?: string };
  [key: string]: unknown;
};

export type ReplayFrame = {
  sequence?: number;
  receivedAt?: string;
  payload: ReplayPayload;
};

export type ReplayDocument = {
  schemaVersion: string;
  exportedAt?: string;
  match: {
    id: string;
    schemaVersion?: string;
    status?: string;
    startedAt: string;
    endedAt?: string | null;
    frames: ReplayFrame[];
    [key: string]: unknown;
  };
};

export type ReplayMetadata = typeof replays.$inferSelect;
export type AdminReplayMetadata = ReplayMetadata & {
  username: string;
};

export type ReplayMetricTotals = Omit<typeof replayMetrics.$inferSelect, "replayId" | "calculatedAt">;
export type ReplayStatsRecord = ReplayMetadata & { metrics: ReplayMetricTotals | null };
export type ReplayPage<T> = { items: T[]; nextCursor: string | null };

export class ReplayUploadError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function heroId(frames: ReplayFrame[], side: "playerEquipment" | "opponentEquipment") {
  for (const frame of frames) {
    const cards = frame.payload[side];
    if (!Array.isArray(cards)) continue;
    const hero = cards.find((card) => card?.slot === "Hero" && card.cardNumber);
    if (hero?.cardNumber) return hero.cardNumber;
  }
  return null;
}

function gameMode(document: ReplayDocument) {
  const matchMode = document.match.gameFormat;
  if (typeof matchMode === "string" && matchMode.trim()) {
    return matchMode.trim().toLowerCase();
  }
  for (const frame of document.match.frames) {
    const frameMode = frame.payload.initialLoad?.gameFormat;
    if (typeof frameMode === "string" && frameMode.trim()) {
      return frameMode.trim().toLowerCase();
    }
  }
  return null;
}

export function isCompleteReplay(document: ReplayDocument): boolean {
  return document.match.frames.some(
    (frame) => frame.payload?.turnPhase?.turnPhase === "OVER",
  );
}

export function parseReplayDocument(raw: string): ReplayDocument {
  if (Buffer.byteLength(raw, "utf8") > MAX_REPLAY_BYTES) {
    throw new ReplayUploadError("O replay excede o limite de 50 MB.", 413);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ReplayUploadError("O arquivo enviado não contém JSON válido.", 400);
  }

  validateStructuralLimits(value);

  const document = value as Partial<ReplayDocument>;
  const match = document?.match;
  if (
    typeof document?.schemaVersion !== "string" ||
    !match ||
    typeof match !== "object" ||
    typeof match.id !== "string" ||
    !UUID_PATTERN.test(match.id) ||
    typeof match.startedAt !== "string" ||
    !Array.isArray(match.frames) ||
    match.frames.length === 0 ||
    match.frames.some((frame) => !frame || typeof frame !== "object" || !frame.payload || typeof frame.payload !== "object")
  ) {
    throw new ReplayUploadError("A estrutura do replay é inválida.", 400);
  }
  if (parseTimestamp(match.startedAt) === null) {
    throw new ReplayUploadError("A data inicial do replay é inválida.", 400);
  }
  const compacted = compactReplayDocument(document as ReplayDocument) as ReplayDocument;
  if (!isCompleteReplay(compacted)) {
    throw new ReplayUploadError("A partida ainda não foi concluída.", 422);
  }
  return compacted;
}

function validateStructuralLimits(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > MAX_DOCUMENT_DEPTH) {
      throw new ReplayUploadError("O replay excede o limite de profundidade.", 400, "STRUCTURE_LIMIT");
    }
    if (typeof current.value === "string" && current.value.length > MAX_STRING_LENGTH) {
      throw new ReplayUploadError("O replay contém uma string grande demais.", 400, "STRUCTURE_LIMIT");
    }
    if (
      typeof current.value === "number" &&
      (!Number.isFinite(current.value) || Math.abs(current.value) > Number.MAX_SAFE_INTEGER)
    ) {
      throw new ReplayUploadError("O replay contém um número fora do limite.", 400, "STRUCTURE_LIMIT");
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (Array.isArray(current.value) && current.value.length > MAX_COLLECTION_LENGTH) {
      throw new ReplayUploadError("O replay contém uma lista grande demais.", 400, "STRUCTURE_LIMIT");
    }
    const entries = Object.values(current.value);
    if (!Array.isArray(current.value) && entries.length > MAX_OBJECT_KEYS) {
      throw new ReplayUploadError("O replay contém um objeto grande demais.", 400, "STRUCTURE_LIMIT");
    }
    for (const entry of entries) {
      pending.push({ value: entry, depth: current.depth + 1 });
    }
  }

  const document = value as Partial<ReplayDocument>;
  if (Array.isArray(document.match?.frames) && document.match.frames.length > MAX_REPLAY_FRAMES) {
    throw new ReplayUploadError("O replay excede o limite de frames.", 400, "STRUCTURE_LIMIT");
  }
  if (document.match?.endedAt !== undefined && document.match.endedAt !== null && parseTimestamp(document.match.endedAt) === null) {
    throw new ReplayUploadError("O replay contém um timestamp inválido.", 400, "STRUCTURE_LIMIT");
  }
  for (const frame of document.match?.frames ?? []) {
    if (frame.receivedAt !== undefined && parseTimestamp(frame.receivedAt) === null) {
      throw new ReplayUploadError("O replay contém um timestamp inválido.", 400, "STRUCTURE_LIMIT");
    }
  }
}

function extractedMetadata(document: ReplayDocument) {
  const { match } = document;
  const last = match.frames.at(-1)!;
  const finalFrame = [...match.frames].reverse().find(
    (frame) => frame.payload.turnPhase?.turnPhase === "OVER",
  ) ?? last;
  const result = replayResult(match);

  return {
    schemaVersion: document.schemaVersion,
    status: "finished",
    result,
    gameMode: gameMode(document),
    playerHeroId: heroId(match.frames, "playerEquipment"),
    opponentHeroId: heroId(match.frames, "opponentEquipment"),
    startedAt: parseTimestamp(match.startedAt)!,
    endedAt: parseTimestamp(match.endedAt) ?? parseTimestamp(finalFrame.receivedAt),
    finalTurn: numeric(finalFrame.payload.turnNo),
    frameCount: match.frames.length,
  };
}

function extractedMetrics(document: ReplayDocument): ReplayMetricTotals {
  const cycles = calculateReplayTelemetry(document);
  return cycles.reduce<ReplayMetricTotals>((totals, cycle) => ({
    receivedDamage: totals.receivedDamage + cycle.receivedDamage,
    equipmentBlocked: totals.equipmentBlocked + cycle.equipmentBlocked,
    cardBlocked: totals.cardBlocked + cycle.cardBlocked,
    offeredDamage: totals.offeredDamage + cycle.offeredDamage,
    lifeGained: totals.lifeGained + cycle.lifeGained,
    cycleCount: totals.cycleCount + 1,
  }), {
    receivedDamage: 0,
    equipmentBlocked: 0,
    cardBlocked: 0,
    offeredDamage: 0,
    lifeGained: 0,
    cycleCount: 0,
  });
}

export async function saveReplayUpload(userId: number, raw: string) {
  const document = parseReplayDocument(raw);
  const database = getDb();
  const existing = database
    .select()
    .from(replays)
    .where(eq(replays.sourceMatchId, document.match.id))
    .get();

  if (existing) {
    if (existing.userId !== userId) {
      throw new ReplayUploadError("Esta captura já pertence a outra conta.", 409);
    }
    if (!existing.gameMode) {
      const metadata = extractedMetadata(document);
      if (metadata.gameMode) {
        const updated = database
          .update(replays)
          .set({ gameMode: metadata.gameMode })
          .where(eq(replays.id, existing.id))
          .returning()
          .get();
        return { replay: updated, duplicate: true };
      }
    }
    return { replay: existing, duplicate: true };
  }

  const storageKey = `${randomUUID()}.json`;
  const normalizedRaw = JSON.stringify(document);
  const sizeBytes = Buffer.byteLength(normalizedRaw, "utf8");
  const metrics = extractedMetrics(document);
  assertQuota(userId, sizeBytes);
  const storage = getReplayStorage();
  await storage.writeAtomic(storageKey, normalizedRaw);

  try {
    const replay = database.transaction((transaction) => {
      const usage = transaction
        .select({ replayCount: count(), totalBytes: sum(replays.sizeBytes) })
        .from(replays)
        .where(eq(replays.userId, userId))
        .get();
      assertQuotaUsage(usage?.replayCount ?? 0, Number(usage?.totalBytes ?? 0), sizeBytes);
      const inserted = transaction
        .insert(replays)
        .values({
          userId,
          sourceMatchId: document.match.id,
          storageKey,
          sizeBytes,
          ...extractedMetadata(document),
        })
        .returning()
        .get();
      transaction.insert(replayMetrics).values({ replayId: inserted.id, ...metrics }).run();
      return inserted;
    });
    return { replay, duplicate: false };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    const concurrent = database
      .select()
      .from(replays)
      .where(eq(replays.sourceMatchId, document.match.id))
      .get();
    if (concurrent) {
      if (concurrent.userId !== userId) {
        throw new ReplayUploadError("Esta captura já pertence a outra conta.", 409);
      }
      return { replay: concurrent, duplicate: true };
    }
    throw error;
  }
}

function quotaLimit(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : fallback;
}

function assertQuota(
  userId: number,
  incomingBytes: number,
): void {
  const usage = getDb()
    .select({ replayCount: count(), totalBytes: sum(replays.sizeBytes) })
    .from(replays)
    .where(eq(replays.userId, userId))
    .get();
  assertQuotaUsage(usage?.replayCount ?? 0, Number(usage?.totalBytes ?? 0), incomingBytes);
}

function assertQuotaUsage(replayCount: number, totalBytes: number, incomingBytes: number): void {
  const maxBytes = quotaLimit("REPLAY_QUOTA_BYTES", 1024 * 1024 * 1024);
  const maxReplays = quotaLimit("REPLAY_QUOTA_COUNT", 500);
  if (replayCount >= maxReplays || totalBytes + incomingBytes > maxBytes) {
    throw new ReplayUploadError("A quota de replays desta conta foi atingida.", 413, "REPLAY_QUOTA_EXCEEDED");
  }
}

export async function listUserReplays(userId: number, cursor?: string | null): Promise<ReplayPage<ReplayMetadata>> {
  const position = decodeCursor(cursor);
  const condition = position
    ? and(eq(replays.userId, userId), or(
      lt(replays.startedAt, position.startedAt),
      and(eq(replays.startedAt, position.startedAt), lt(replays.id, position.id)),
    ))
    : eq(replays.userId, userId);
  const replayList = getDb()
    .select()
    .from(replays)
    .where(condition)
    .orderBy(desc(replays.startedAt), desc(replays.id))
    .limit(REPLAY_PAGE_SIZE + 1)
    .all();
  return pageFromRows(replayList);
}

export async function listAdminReplays(cursor?: string | null): Promise<ReplayPage<AdminReplayMetadata>> {
  const position = decodeCursor(cursor);
  const replayList = getDb()
    .select({ replay: replays, username: users.username })
    .from(replays)
    .innerJoin(users, eq(users.id, replays.userId))
    .where(position ? or(
      lt(replays.startedAt, position.startedAt),
      and(eq(replays.startedAt, position.startedAt), lt(replays.id, position.id)),
    ) : undefined)
    .orderBy(desc(replays.startedAt), desc(replays.id))
    .limit(REPLAY_PAGE_SIZE + 1)
    .all();
  return pageFromRows(replayList.map(({ replay, username }) => ({ ...replay, username })));
}

function pageFromRows<T extends { id: number; startedAt: number }>(rows: T[]): ReplayPage<T> {
  const hasMore = rows.length > REPLAY_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, REPLAY_PAGE_SIZE) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ startedAt: last.startedAt, id: last.id })).toString("base64url")
      : null,
  };
}

function decodeCursor(cursor?: string | null): { startedAt: number; id: number } | null {
  if (!cursor || cursor.length > 256) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isSafeInteger(value?.startedAt) && Number.isSafeInteger(value?.id)
      ? { startedAt: value.startedAt, id: value.id }
      : null;
  } catch {
    return null;
  }
}

export function listUserReplayStats(userId: number): ReplayStatsRecord[] {
  return getDb()
    .select({ replay: replays, metrics: replayMetrics })
    .from(replays)
    .leftJoin(replayMetrics, eq(replayMetrics.replayId, replays.id))
    .where(eq(replays.userId, userId))
    .orderBy(desc(replays.startedAt), desc(replays.id))
    .all()
    .map(({ replay, metrics }) => ({
      ...replay,
      metrics: metrics ? {
        receivedDamage: metrics.receivedDamage,
        equipmentBlocked: metrics.equipmentBlocked,
        cardBlocked: metrics.cardBlocked,
        offeredDamage: metrics.offeredDamage,
        lifeGained: metrics.lifeGained,
        cycleCount: metrics.cycleCount,
      } : null,
    }));
}

export function findUserReplay(userId: number, replayId: string): ReplayMetadata | null {
  const database = getDb();
  const bySourceId = database
    .select()
    .from(replays)
    .where(and(eq(replays.sourceMatchId, replayId), eq(replays.userId, userId)))
    .get();
  if (bySourceId) return bySourceId;
  if (!/^\d+$/.test(replayId)) return null;
  return database
    .select()
    .from(replays)
    .where(and(eq(replays.id, Number(replayId)), eq(replays.userId, userId)))
    .get() ?? null;
}

export async function readUserReplay(userId: number, replayId: string) {
  const replay = findUserReplay(userId, replayId);
  if (!replay) return null;
  return readReplay(replay);
}

export function findAdminReplay(replayId: string): ReplayMetadata | null {
  const database = getDb();
  const bySourceId = database
    .select()
    .from(replays)
    .where(eq(replays.sourceMatchId, replayId))
    .get();
  if (bySourceId) return bySourceId;
  if (!/^\d+$/.test(replayId)) return null;
  return database
    .select()
    .from(replays)
    .where(eq(replays.id, Number(replayId)))
    .get() ?? null;
}

export async function readAdminReplay(replayId: string) {
  const replay = findAdminReplay(replayId);
  if (!replay) return null;
  return readReplay(replay);
}

async function readReplay(replay: ReplayMetadata) {
  const raw = await getReplayStorage().read(replay.storageKey);
  return {
    metadata: replay,
    raw,
  };
}

export async function quarantineReplayFiles(storageKeys: string[]): Promise<QuarantinedReplay[]> {
  return getReplayStorage().quarantine(storageKeys);
}

export async function restoreReplayFiles(items: QuarantinedReplay[]): Promise<void> {
  await getReplayStorage().restore(items);
}

export async function deleteQuarantinedReplayFiles(items: QuarantinedReplay[]): Promise<void> {
  await getReplayStorage().deleteQuarantined(items);
}

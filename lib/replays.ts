import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { replays } from "../db/schema";

export const MAX_REPLAY_BYTES = 50 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReplayCard = {
  cardNumber?: string;
  slot?: string;
  controller?: string | number;
};

export type ReplayChain = {
  attackingCard?: ReplayCard;
  totalPower?: string | number;
  totalDefense?: string | number;
};

export type ReplayPayload = {
  turnNo?: string | number;
  turnPlayer?: string | number;
  turnPhase?: { turnPhase?: string };
  playerHealth?: string | number;
  opponentHealth?: string | number;
  playerEquipment?: ReplayCard[];
  opponentEquipment?: ReplayCard[];
  activeChainLink?: ReplayChain | null;
  initialLoad?: { gameFormat?: string };
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

export class ReplayUploadError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function uploadsDirectory() {
  return resolve(process.env.UPLOADS_DIR || "data/uploads");
}

function replayPath(storageKey: string) {
  return resolve(uploadsDirectory(), storageKey);
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
  if (!parseTimestamp(match.startedAt)) {
    throw new ReplayUploadError("A data inicial do replay é inválida.", 400);
  }
  if (!isCompleteReplay(document as ReplayDocument)) {
    throw new ReplayUploadError("A partida ainda não foi concluída.", 422);
  }
  return document as ReplayDocument;
}

function extractedMetadata(document: ReplayDocument) {
  const { match } = document;
  const last = match.frames.at(-1)!;
  const finalFrame = [...match.frames].reverse().find(
    (frame) => frame.payload.turnPhase?.turnPhase === "OVER",
  ) ?? last;
  const playerHealth = numeric(finalFrame.payload.playerHealth);
  const opponentHealth = numeric(finalFrame.payload.opponentHealth);
  const result = playerHealth !== null && playerHealth <= 0
    ? "defeat"
    : opponentHealth !== null && opponentHealth <= 0
      ? "victory"
      : "unknown";

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

  const directory = uploadsDirectory();
  const storageKey = `${randomUUID()}.json`;
  const temporaryPath = resolve(directory, `.${storageKey}.tmp`);
  const finalPath = replayPath(storageKey);
  await mkdir(directory, { recursive: true });
  await writeFile(temporaryPath, raw, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, finalPath);

  try {
    const replay = database
      .insert(replays)
      .values({
        userId,
        sourceMatchId: document.match.id,
        storageKey,
        ...extractedMetadata(document),
      })
      .returning()
      .get();
    return { replay, duplicate: false };
  } catch (error) {
    await unlink(finalPath).catch(() => undefined);
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

export function listUserReplays(userId: number): ReplayMetadata[] {
  return getDb()
    .select()
    .from(replays)
    .where(eq(replays.userId, userId))
    .orderBy(desc(replays.startedAt), desc(replays.uploadedAt))
    .all();
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
  return {
    metadata: replay,
    raw: await readFile(replayPath(replay.storageKey), "utf8"),
  };
}

export async function deleteReplayFiles(storageKeys: string[]): Promise<void> {
  await Promise.all(
    storageKeys.map((storageKey) => unlink(replayPath(storageKey)).catch(() => undefined)),
  );
}

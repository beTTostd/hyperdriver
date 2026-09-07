import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { adminJsonFiles, users } from "../db/schema";

export const MAX_ADMIN_JSON_BYTES = 50 * 1024 * 1024;

export type AdminJsonFileRecord = typeof adminJsonFiles.$inferSelect & {
  adminUsername: string;
};

export class AdminJsonFileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

class AdminJsonStorage {
  private readonly directory = resolve(process.env.UPLOADS_DIR || "data/uploads", "admin-json");

  async writeAtomic(storageKey: string, contents: Uint8Array): Promise<void> {
    const destination = this.path(storageKey);
    const temporary = this.path(`.${storageKey}.${randomUUID()}.tmp`);
    await mkdir(this.directory, { recursive: true });
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, destination);
      const directoryHandle = await open(this.directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(storageKey: string): Promise<Uint8Array> {
    return readFile(this.path(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.path(storageKey), { force: true });
  }

  private path(storageKey: string): string {
    if (
      basename(storageKey) !== storageKey ||
      !/^(?:\.[0-9a-f-]+\.json\.[0-9a-f-]+\.tmp|[0-9a-f-]+\.json)$/i.test(storageKey)
    ) {
      throw new Error("Invalid admin JSON storage key.");
    }
    return resolve(this.directory, storageKey);
  }
}

function storage() {
  return new AdminJsonStorage();
}

export function listAdminJsonFiles(): AdminJsonFileRecord[] {
  return getDb()
    .select({ file: adminJsonFiles, adminUsername: users.username })
    .from(adminJsonFiles)
    .innerJoin(users, eq(users.id, adminJsonFiles.adminUserId))
    .orderBy(desc(adminJsonFiles.uploadedAt), desc(adminJsonFiles.id))
    .all()
    .map(({ file, adminUsername }) => ({ ...file, adminUsername }));
}

export async function saveAdminJsonFile(
  adminUserId: number,
  originalName: string,
  contents: Uint8Array,
): Promise<AdminJsonFileRecord> {
  if (!originalName.toLowerCase().endsWith(".json")) {
    throw new AdminJsonFileError("Selecione um arquivo com nome terminado em .json.", 400);
  }
  if (contents.byteLength > MAX_ADMIN_JSON_BYTES) {
    throw new AdminJsonFileError("O arquivo excede o limite de 50 MB.", 413);
  }

  const storageKey = `${randomUUID()}.json`;
  const fileStorage = storage();
  try {
    await fileStorage.writeAtomic(storageKey, contents);
  } catch {
    throw new AdminJsonFileError("Não foi possível armazenar o arquivo.", 500);
  }

  try {
    const file = getDb()
      .insert(adminJsonFiles)
      .values({
        adminUserId,
        originalName,
        storageKey,
        sizeBytes: contents.byteLength,
      })
      .returning()
      .get();
    const adminUsername = getDb()
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, adminUserId))
      .get()?.username ?? "—";
    return { ...file, adminUsername };
  } catch {
    await fileStorage.delete(storageKey).catch(() => undefined);
    throw new AdminJsonFileError("Não foi possível registrar o arquivo.", 500);
  }
}

export async function readAdminJsonFile(id: number) {
  const file = getDb()
    .select()
    .from(adminJsonFiles)
    .where(eq(adminJsonFiles.id, id))
    .get();
  if (!file) return null;
  return { file, contents: await storage().read(file.storageKey) };
}

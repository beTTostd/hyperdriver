import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export type QuarantinedReplay = {
  storageKey: string;
  quarantineKey: string;
};

export interface ReplayStorage {
  writeAtomic(storageKey: string, contents: string): Promise<void>;
  read(storageKey: string): Promise<string>;
  quarantine(storageKeys: string[]): Promise<QuarantinedReplay[]>;
  restore(items: QuarantinedReplay[]): Promise<void>;
  deleteQuarantined(items: QuarantinedReplay[]): Promise<void>;
  delete(storageKey: string): Promise<void>;
  ready(): Promise<boolean>;
}

export class LocalReplayStorage implements ReplayStorage {
  constructor(private readonly directory = resolve(process.env.UPLOADS_DIR || "data/uploads")) {}

  async writeAtomic(storageKey: string, contents: string): Promise<void> {
    const finalPath = this.path(storageKey);
    const temporaryPath = this.path(`.${storageKey}.${randomUUID()}.tmp`);
    await mkdir(this.directory, { recursive: true });
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, finalPath);
      await this.syncDirectory(this.directory);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(storageKey: string): Promise<string> {
    return readFile(this.path(storageKey), "utf8");
  }

  async quarantine(storageKeys: string[]): Promise<QuarantinedReplay[]> {
    const quarantineDirectory = resolve(this.directory, ".quarantine", randomUUID());
    await mkdir(quarantineDirectory, { recursive: true });
    const moved: QuarantinedReplay[] = [];
    try {
      for (const storageKey of storageKeys) {
        const quarantineKey = `${basename(quarantineDirectory)}/${storageKey}`;
        try {
          await rename(this.path(storageKey), resolve(this.directory, ".quarantine", quarantineKey));
          moved.push({ storageKey, quarantineKey });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await this.syncDirectory(this.directory);
      if (moved.length === 0) await rm(quarantineDirectory, { recursive: true, force: true });
      return moved;
    } catch (error) {
      await this.restore(moved);
      await rm(quarantineDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async restore(items: QuarantinedReplay[]): Promise<void> {
    for (const item of items.toReversed()) {
      await rename(
        resolve(this.directory, ".quarantine", item.quarantineKey),
        this.path(item.storageKey),
      ).catch(() => undefined);
    }
    const directories = new Set(items.map((item) => item.quarantineKey.split("/", 1)[0]));
    for (const directory of directories) {
      await rm(resolve(this.directory, ".quarantine", directory), { recursive: true, force: true });
    }
  }

  async deleteQuarantined(items: QuarantinedReplay[]): Promise<void> {
    for (const item of items) {
      await rm(resolve(this.directory, ".quarantine", item.quarantineKey), { force: true });
    }
    const directories = new Set(items.map((item) => item.quarantineKey.split("/", 1)[0]));
    for (const directory of directories) {
      await rm(resolve(this.directory, ".quarantine", directory), { recursive: true, force: true });
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.path(storageKey), { force: true });
  }

  async ready(): Promise<boolean> {
    try {
      await mkdir(this.directory, { recursive: true });
      await access(this.directory, constants.R_OK | constants.W_OK);
      const details = await stat(this.directory);
      return details.isDirectory();
    } catch {
      return false;
    }
  }

  private path(storageKey: string): string {
    if (basename(storageKey) !== storageKey || !/^[.a-zA-Z0-9-]+(?:\.json|\.tmp)$/.test(storageKey)) {
      throw new Error("Invalid replay storage key.");
    }
    return resolve(this.directory, storageKey);
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

let storage: ReplayStorage | undefined;
export function getReplayStorage(): ReplayStorage {
  storage ??= new LocalReplayStorage();
  return storage;
}

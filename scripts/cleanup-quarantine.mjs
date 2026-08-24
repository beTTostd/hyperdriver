import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { configureDatabase } from "./migration-runner.mjs";

const databaseFile = resolve(process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
const uploadsDirectory = resolve(process.env.UPLOADS_DIR || "data/uploads");
const quarantineDirectory = resolve(uploadsDirectory, ".quarantine");
await mkdir(quarantineDirectory, { recursive: true });

const database = new Database(databaseFile);
configureDatabase(database);
const referenced = database.prepare("SELECT 1 FROM replays WHERE storage_key = ?");
let restored = 0;
let removed = 0;

try {
  for (const batch of await readdir(quarantineDirectory, { withFileTypes: true })) {
    if (!batch.isDirectory() || !/^[a-f0-9-]+$/i.test(batch.name)) continue;
    const batchDirectory = resolve(quarantineDirectory, batch.name);
    for (const file of await readdir(batchDirectory, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9-]+\.json$/i.test(file.name)) continue;
      const quarantined = resolve(batchDirectory, file.name);
      if (referenced.get(file.name)) {
        await rename(quarantined, resolve(uploadsDirectory, file.name)).catch(async (error) => {
          if (error.code === "EEXIST") await rm(quarantined, { force: true });
          else throw error;
        });
        restored += 1;
      } else {
        await rm(quarantined, { force: true });
        removed += 1;
      }
    }
    await rm(batchDirectory, { recursive: true, force: true });
  }
} finally {
  database.close();
}

console.log(JSON.stringify({ level: "info", type: "quarantine_cleanup_complete", restored, removed }));

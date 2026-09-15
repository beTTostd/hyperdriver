import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { configureDatabase } from "./migration-runner.mjs";

const databaseFile = resolve(process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
const uploadsDirectory = resolve(process.env.UPLOADS_DIR || "data/uploads");
const backupRoot = resolve(process.env.BACKUP_DIR || join(dirname(databaseFile), "backups"));
const retention = positiveInteger(process.env.BACKUP_RETENTION, 14);

await mkdir(backupRoot, { recursive: true });

if (process.argv.includes("--verify-latest")) {
  const latest = await latestBackup();
  if (!latest) throw new Error("Nenhum backup disponível para verificar.");
  const result = await verifyBackup(latest);
  console.log(JSON.stringify({ level: "info", type: "backup_restore_verified", backup: basename(latest), ...result }));
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const finalDirectory = join(backupRoot, timestamp);
const temporaryDirectory = join(backupRoot, `.creating-${timestamp}-${process.pid}`);
const backupDatabaseFile = join(temporaryDirectory, "hyperdriver.sqlite");

try {
  await mkdir(join(temporaryDirectory, "uploads"), { recursive: true });
  const source = new Database(databaseFile, { readonly: true });
  configureDatabase(source);
  try {
    await source.backup(backupDatabaseFile);
  } finally {
    source.close();
  }

  const snapshot = new Database(backupDatabaseFile, { readonly: true });
  let storageKeys;
  try {
    storageKeys = snapshot.prepare("SELECT storage_key AS storageKey FROM replays ORDER BY id").all();
  } finally {
    snapshot.close();
  }
  for (const { storageKey } of storageKeys) {
    if (basename(storageKey) !== storageKey) throw new Error("Chave de upload inválida no banco.");
    await cp(join(uploadsDirectory, storageKey), join(temporaryDirectory, "uploads", storageKey));
  }
  await rename(temporaryDirectory, finalDirectory);
  const verification = await verifyBackup(finalDirectory);
  await recordSuccess(finalDirectory, verification);
  await pruneBackups();
  console.log(JSON.stringify({ level: "info", type: "backup_complete", backup: basename(finalDirectory), ...verification }));
} catch (error) {
  await rm(temporaryDirectory, { recursive: true, force: true });
  console.error(JSON.stringify({ level: "error", type: "backup_failed", message: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
}

async function verifyBackup(directory) {
  const file = join(directory, "hyperdriver.sqlite");
  const database = new Database(file, { readonly: true });
  let integrity;
  let keys;
  try {
    integrity = database.pragma("integrity_check", { simple: true });
    keys = database.prepare("SELECT storage_key AS storageKey FROM replays ORDER BY id").all();
  } finally {
    database.close();
  }
  if (integrity !== "ok") throw new Error(`Falha no integrity_check: ${integrity}`);
  for (const { storageKey } of keys) {
    const contents = await readFile(join(directory, "uploads", storageKey), "utf8");
    JSON.parse(contents);
  }
  return { replayCount: keys.length, verifiedAt: Date.now() };
}

async function recordSuccess(directory, verification) {
  const database = new Database(databaseFile);
  configureDatabase(database);
  try {
    database.prepare(`
      INSERT INTO maintenance_state (key, value, updated_at) VALUES ('last_successful_backup', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify({ directory: basename(directory), ...verification }), Date.now());
  } finally {
    database.close();
  }
}

async function backupDirectories() {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const path = join(backupRoot, entry.name);
    candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
  }
  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

async function latestBackup() {
  return (await backupDirectories())[0]?.path ?? null;
}

async function pruneBackups() {
  const candidates = await backupDirectories();
  for (const candidate of candidates.slice(retention)) {
    await rm(candidate.path, { recursive: true, force: true });
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

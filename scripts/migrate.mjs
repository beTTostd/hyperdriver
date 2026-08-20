import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const databaseFile = resolve(process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
mkdirSync(dirname(databaseFile), { recursive: true });

const database = new Database(databaseFile);
database.pragma("foreign_keys = ON");
const migration = readFileSync(resolve("drizzle/0000_authentication.sql"), "utf8")
  .replaceAll(/--> statement-breakpoint/g, "")
  .replaceAll("CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `")
  .replaceAll("CREATE INDEX `", "CREATE INDEX IF NOT EXISTS `")
  .replaceAll("CREATE UNIQUE INDEX `", "CREATE UNIQUE INDEX IF NOT EXISTS `");
database.exec(migration);

const userColumns = database.pragma("table_info(users)");
if (!userColumns.some((column) => column.name === "avatar_card_id")) {
  database.exec(readFileSync(resolve("drizzle/0001_user_avatar.sql"), "utf8"));
}
if (!userColumns.some((column) => column.name === "last_login_at")) {
  database.exec(readFileSync(resolve("drizzle/0003_user_last_login.sql"), "utf8"));
}
const replayTable = database
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'replays'")
  .get();
if (!replayTable) {
  database.exec(
    readFileSync(resolve("drizzle/0002_replays.sql"), "utf8")
      .replaceAll(/--> statement-breakpoint/g, ""),
  );
}

const replayColumns = database.pragma("table_info(replays)");
if (!replayColumns.some((column) => column.name === "game_mode")) {
  database.exec(readFileSync(resolve("drizzle/0004_replay_game_mode.sql"), "utf8"));
}

const uploadsDirectory = resolve(process.env.UPLOADS_DIR || "data/uploads");
const missingGameModes = database
  .prepare("SELECT id, storage_key FROM replays WHERE game_mode IS NULL")
  .all();
const updateGameMode = database.prepare(
  "UPDATE replays SET game_mode = ? WHERE id = ?",
);
for (const replay of missingGameModes) {
  try {
    const document = JSON.parse(
      readFileSync(resolve(uploadsDirectory, replay.storage_key), "utf8"),
    );
    const matchMode = document?.match?.gameFormat;
    const frameMode = document?.match?.frames
      ?.find((frame) => frame?.payload?.initialLoad?.gameFormat)
      ?.payload?.initialLoad?.gameFormat;
    const gameMode = typeof matchMode === "string" && matchMode.trim()
      ? matchMode.trim().toLowerCase()
      : typeof frameMode === "string" && frameMode.trim()
        ? frameMode.trim().toLowerCase()
        : null;
    if (gameMode) updateGameMode.run(gameMode, replay.id);
  } catch {
    // Keep unknown modes nullable when an older replay file is unavailable.
  }
}
database.close();

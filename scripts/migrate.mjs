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
database.close();

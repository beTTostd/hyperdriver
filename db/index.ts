import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const databaseFile = resolve(
  process.env.DATABASE_FILE || "data/hyperdriver.sqlite",
);

type Database = ReturnType<typeof drizzle<typeof schema>>;
let database: Database | undefined;
let sqlite: import("better-sqlite3").Database | undefined;

export function getDb() {
  if (!database) {
    mkdirSync(dirname(databaseFile), { recursive: true });
    sqlite = new BetterSqlite3(databaseFile);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("synchronous = NORMAL");
    database = drizzle(sqlite, { schema });
  }

  return database;
}

export function getSqlite() {
  getDb();
  return sqlite!;
}

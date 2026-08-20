import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const databaseFile = resolve(
  process.env.DATABASE_FILE || "data/hyperdriver.sqlite",
);

type Database = ReturnType<typeof drizzle<typeof schema>>;
let database: Database | undefined;

export function getDb() {
  if (!database) {
    mkdirSync(dirname(databaseFile), { recursive: true });
    database = drizzle({
      connection: { source: databaseFile },
      schema,
    });
  }

  return database;
}

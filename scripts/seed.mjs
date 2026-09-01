import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { configureDatabase, runMigrations } from "./migration-runner.mjs";

const databaseFile = resolve(process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
const password = process.env.ADMIN_INITIAL_PASSWORD;
const MAX_PASSWORD_LENGTH = 256;

runMigrations({ databaseFile });
const database = new Database(databaseFile);
configureDatabase(database);

const existing = database
  .prepare("SELECT id FROM users WHERE username = ?")
  .get("admin");

if (!existing) {
  if (!password) {
    database.close();
    throw new Error(
      "No admin user exists. Set ADMIN_INITIAL_PASSWORD before starting the application.",
    );
  }

  if (!isStrongPassword(password)) {
    database.close();
    throw new Error(
      `ADMIN_INITIAL_PASSWORD must have between 12 and ${MAX_PASSWORD_LENGTH} characters, uppercase, lowercase, number and symbol.`,
    );
  }

  database
    .prepare(
      "INSERT INTO users (username, role, password_hash, is_active) VALUES (?, 'admin', ?, 1)",
    )
    .run("admin", await hashPassword(password));
  console.log("Created initial admin user.");
} else {
  console.log("Initial admin user already exists; no changes made.");
}

database.close();

async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await promisify(nodeScrypt)(value, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

function isStrongPassword(value) {
  return (
    value.length >= 12 &&
    value.length <= MAX_PASSWORD_LENGTH &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

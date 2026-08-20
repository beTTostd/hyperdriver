import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const databaseFile = resolve(process.env.DATABASE_FILE || "data/hyperdriver.sqlite");
const password = process.env.ADMIN_INITIAL_PASSWORD;

mkdirSync(dirname(databaseFile), { recursive: true });
const database = new Database(databaseFile);
database.pragma("foreign_keys = ON");
database.exec(readSchema());

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
      "ADMIN_INITIAL_PASSWORD must have at least 12 characters, uppercase, lowercase, number and symbol.",
    );
  }

  database
    .prepare(
      "INSERT INTO users (username, role, password_hash, is_active) VALUES (?, 'admin', ?, 1)",
    )
    .run("admin", hashPassword(password));
  console.log("Created initial admin user.");
} else {
  console.log("Initial admin user already exists; no changes made.");
}

database.close();

function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(value, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

function isStrongPassword(value) {
  return (
    value.length >= 12 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function readSchema() {
  return `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      password_hash TEXT,
      avatar_card_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS password_setup_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS password_setup_tokens_user_idx ON password_setup_tokens(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS password_setup_tokens_hash_unique ON password_setup_tokens(token_hash);
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions(token_hash);
    CREATE TABLE IF NOT EXISTS replays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_match_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT NOT NULL,
      game_mode TEXT,
      player_hero_id TEXT,
      opponent_hero_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      final_turn INTEGER,
      frame_count INTEGER NOT NULL,
      uploaded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS replays_source_match_unique ON replays(source_match_id);
    CREATE UNIQUE INDEX IF NOT EXISTS replays_storage_key_unique ON replays(storage_key);
    CREATE INDEX IF NOT EXISTS replays_user_uploaded_idx ON replays(user_id, uploaded_at);
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username);
  `;
}

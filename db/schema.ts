import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull(),
    passwordHash: text("password_hash"),
    avatarCardId: text("avatar_card_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

export const passwordSetupTokens = sqliteTable(
  "password_setup_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("password_setup_tokens_hash_unique").on(table.tokenHash),
    index("password_setup_tokens_user_idx").on(table.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const replays = sqliteTable(
  "replays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceMatchId: text("source_match_id").notNull(),
    storageKey: text("storage_key").notNull(),
    schemaVersion: text("schema_version").notNull(),
    status: text("status").notNull(),
    result: text("result").notNull(),
    playerHeroId: text("player_hero_id"),
    opponentHeroId: text("opponent_hero_id"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    finalTurn: integer("final_turn"),
    frameCount: integer("frame_count").notNull(),
    uploadedAt: integer("uploaded_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("replays_source_match_unique").on(table.sourceMatchId),
    uniqueIndex("replays_storage_key_unique").on(table.storageKey),
    index("replays_user_uploaded_idx").on(table.userId, table.uploadedAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  passwordSetupTokens: many(passwordSetupTokens),
  sessions: many(sessions),
  replays: many(replays),
}));

export const passwordSetupTokensRelations = relations(
  passwordSetupTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordSetupTokens.userId],
      references: [users.id],
    }),
  }),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const replaysRelations = relations(replays, ({ one }) => ({
  user: one(users, {
    fields: [replays.userId],
    references: [users.id],
  }),
}));

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
    lastLoginAt: integer("last_login_at"),
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
    gameMode: text("game_mode"),
    playerHeroId: text("player_hero_id"),
    opponentHeroId: text("opponent_hero_id"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    finalTurn: integer("final_turn"),
    frameCount: integer("frame_count").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedAt: integer("uploaded_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("replays_source_match_unique").on(table.sourceMatchId),
    uniqueIndex("replays_storage_key_unique").on(table.storageKey),
    index("replays_user_uploaded_idx").on(table.userId, table.uploadedAt),
  ],
);

export const replayMetrics = sqliteTable(
  "replay_metrics",
  {
    replayId: integer("replay_id")
      .primaryKey()
      .references(() => replays.id, { onDelete: "cascade" }),
    receivedDamage: integer("received_damage").notNull().default(0),
    equipmentBlocked: integer("equipment_blocked").notNull().default(0),
    cardBlocked: integer("card_blocked").notNull().default(0),
    offeredDamage: integer("offered_damage").notNull().default(0),
    lifeGained: integer("life_gained").notNull().default(0),
    cycleCount: integer("cycle_count").notNull().default(0),
    calculationVersion: integer("calculation_version").notNull().default(1),
    calculatedAt: integer("calculated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
);

export const rateLimitEvents = sqliteTable(
  "rate_limit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bucket: text("bucket").notNull(),
    identity: text("identity").notNull(),
    occurredAt: integer("occurred_at").notNull(),
  },
  (table) => [
    index("rate_limit_events_lookup_idx").on(table.bucket, table.identity, table.occurredAt),
    index("rate_limit_events_expiry_idx").on(table.occurredAt),
  ],
);

export const uploadLeases = sqliteTable(
  "upload_leases",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("upload_leases_user_expiry_idx").on(table.userId, table.expiresAt)],
);

export const uploadEvents = sqliteTable(
  "upload_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    attemptedAt: integer("attempted_at").notNull().default(sql`(unixepoch() * 1000)`),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceMatchId: text("source_match_id"),
    category: text("category").notNull(),
    httpStatus: integer("http_status").notNull(),
    errorCode: text("error_code"),
    technicalMessage: text("technical_message"),
    replayId: integer("replay_id").references(() => replays.id, { onDelete: "set null" }),
  },
  (table) => [
    index("upload_events_attempted_idx").on(table.attemptedAt),
    index("upload_events_category_attempted_idx").on(table.category, table.attemptedAt),
    index("upload_events_user_attempted_idx").on(table.userId, table.attemptedAt),
  ],
);

// Named alias kept for callers that want to describe the table by its domain.
export const uploadTelemetryEvents = uploadEvents;

export const usersRelations = relations(users, ({ many }) => ({
  passwordSetupTokens: many(passwordSetupTokens),
  sessions: many(sessions),
  replays: many(replays),
  uploadLeases: many(uploadLeases),
  uploadEvents: many(uploadEvents),
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

export const replaysRelations = relations(replays, ({ one, many }) => ({
  user: one(users, {
    fields: [replays.userId],
    references: [users.id],
  }),
  metrics: one(replayMetrics, {
    fields: [replays.id],
    references: [replayMetrics.replayId],
  }),
  uploadEvents: many(uploadEvents),
}));

export const replayMetricsRelations = relations(replayMetrics, ({ one }) => ({
  replay: one(replays, {
    fields: [replayMetrics.replayId],
    references: [replays.id],
  }),
}));

export const uploadLeasesRelations = relations(uploadLeases, ({ one }) => ({
  user: one(users, {
    fields: [uploadLeases.userId],
    references: [users.id],
  }),
}));

export const uploadEventsRelations = relations(uploadEvents, ({ one }) => ({
  user: one(users, {
    fields: [uploadEvents.userId],
    references: [users.id],
  }),
  replay: one(replays, {
    fields: [uploadEvents.replayId],
    references: [replays.id],
  }),
}));

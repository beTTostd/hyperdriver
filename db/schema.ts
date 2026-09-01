import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
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

export const analysisModelVersions = sqliteTable(
  "analysis_model_versions",
  {
    id: text("id").primaryKey(),
    analysisSchema: text("analysis_schema").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    cardCatalogVersion: text("card_catalog_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    talisharCommit: text("talishar_commit").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
);

export const replayAnalyses = sqliteTable(
  "replay_analyses",
  {
    replayId: integer("replay_id")
      .primaryKey()
      .references(() => replays.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id").references(() => analysisModelVersions.id),
    status: text("status", { enum: ["pending", "ready", "insufficient_data", "failed"] }).notNull(),
    observationCount: integer("observation_count").notNull().default(0),
    analysisCount: integer("analysis_count").notNull().default(0),
    summaryJson: text("summary_json"),
    methodologyJson: text("methodology_json"),
    errorCode: text("error_code"),
    queuedAt: integer("queued_at").notNull().default(sql`(unixepoch() * 1000)`),
    analyzedAt: integer("analyzed_at"),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("replay_analyses_status_idx").on(table.status, table.updatedAt)],
);

export const decisionObservations = sqliteTable(
  "decision_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    replayId: integer("replay_id")
      .notNull()
      .references(() => replays.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    frameSequence: integer("frame_sequence").notNull(),
    frameIndex: integer("frame_index").notNull(),
    turn: integer("turn"),
    kind: text("kind").notNull(),
    stateFingerprint: text("state_fingerprint").notNull(),
    handFingerprint: text("hand_fingerprint").notNull(),
    dataQuality: text("data_quality").notNull(),
    stateJson: text("state_json").notNull(),
    legalActionsJson: text("legal_actions_json").notNull(),
    chosenActionJson: text("chosen_action_json"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("decision_observations_replay_ordinal_unique").on(table.replayId, table.ordinal),
    index("decision_observations_fingerprint_idx").on(table.stateFingerprint),
    index("decision_observations_replay_kind_idx").on(table.replayId, table.kind),
  ],
);

export const handAnalyses = sqliteTable(
  "hand_analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    replayId: integer("replay_id")
      .notNull()
      .references(() => replays.id, { onDelete: "cascade" }),
    observationId: integer("observation_id")
      .notNull()
      .references(() => decisionObservations.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => analysisModelVersions.id),
    stateFingerprint: text("state_fingerprint").notNull(),
    frameSequence: integer("frame_sequence").notNull(),
    frameIndex: integer("frame_index").notNull(),
    turn: integer("turn"),
    decisionKind: text("decision_kind").notNull(),
    marker: text("marker"),
    confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
    handPotential: real("hand_potential").notNull(),
    executionQuality: real("execution_quality").notNull(),
    chosenValue: real("chosen_value").notNull(),
    bestValue: real("best_value").notNull(),
    regretPp: real("regret_pp").notNull(),
    tagsJson: text("tags_json").notNull(),
    analysisJson: text("analysis_json").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("hand_analyses_observation_model_unique").on(table.observationId, table.modelVersionId),
    index("hand_analyses_replay_frame_idx").on(table.replayId, table.frameSequence),
    index("hand_analyses_replay_marker_idx").on(table.replayId, table.marker),
  ],
);

export const analysisFeedback = sqliteTable(
  "analysis_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    replayId: integer("replay_id")
      .notNull()
      .references(() => replays.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    analysisFingerprint: text("analysis_fingerprint").notNull(),
    helpful: integer("helpful", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("analysis_feedback_user_analysis_unique").on(table.userId, table.replayId, table.analysisFingerprint),
    index("analysis_feedback_replay_idx").on(table.replayId),
  ],
);

export const decisionDatasetExamples = sqliteTable(
  "decision_dataset_examples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    replayId: integer("replay_id")
      .notNull()
      .references(() => replays.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => analysisModelVersions.id),
    exampleKey: text("example_key").notNull(),
    userCohort: text("user_cohort").notNull(),
    decisionKind: text("decision_kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("decision_dataset_examples_key_unique").on(table.exampleKey),
    index("decision_dataset_examples_replay_idx").on(table.replayId),
    index("decision_dataset_examples_cohort_idx").on(table.userCohort, table.createdAt),
  ],
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

export const talisharPlayers = sqliteTable(
  "talishar_players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    normalizedName: text("normalized_name").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [uniqueIndex("talishar_players_normalized_name_unique").on(table.normalizedName)],
);

export const eloRatings = sqliteTable(
  "elo_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id").notNull().references(() => talisharPlayers.id, { onDelete: "restrict" }),
    format: text("format").notNull(),
    rating: real("rating").notNull().default(1000),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("elo_ratings_player_format_unique").on(table.playerId, table.format),
    index("elo_ratings_format_rank_idx").on(table.format, table.rating),
  ],
);

export const eloMatches = sqliteTable(
  "elo_matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameGuid: text("game_guid").notNull(),
    format: text("format").notNull(),
    winnerPlayerId: integer("winner_player_id").notNull().references(() => talisharPlayers.id, { onDelete: "restrict" }),
    loserPlayerId: integer("loser_player_id").notNull().references(() => talisharPlayers.id, { onDelete: "restrict" }),
    winnerRatingBefore: real("winner_rating_before").notNull(),
    loserRatingBefore: real("loser_rating_before").notNull(),
    ratingChange: real("rating_change").notNull(),
    status: text("status", { enum: ["unconfirmed", "confirmed", "conflict"] }).notNull().default("unconfirmed"),
    firstUploaderUserId: integer("first_uploader_user_id").notNull(),
    firstSourceMatchId: text("first_source_match_id").notNull(),
    conflictReason: text("conflict_reason"),
    scoredAt: integer("scored_at").notNull().default(sql`(unixepoch() * 1000)`),
    confirmedAt: integer("confirmed_at"),
    conflictAt: integer("conflict_at"),
  },
  (table) => [
    uniqueIndex("elo_matches_game_guid_unique").on(table.gameGuid),
    index("elo_matches_conflict_idx").on(table.status, table.conflictAt),
  ],
);

export const eloUploadReports = sqliteTable(
  "elo_upload_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eloMatchId: integer("elo_match_id").references(() => eloMatches.id, { onDelete: "restrict" }),
    gameGuid: text("game_guid"),
    sourceMatchId: text("source_match_id").notNull(),
    uploaderUserId: integer("uploader_user_id").notNull(),
    status: text("status", { enum: ["applied", "confirmed", "duplicate", "conflict", "ignored"] }).notNull(),
    reason: text("reason"),
    format: text("format"),
    playerName: text("player_name"),
    opponentName: text("opponent_name"),
    winnerName: text("winner_name"),
    uploadedAt: integer("uploaded_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("elo_upload_reports_match_uploader_idx").on(table.eloMatchId, table.uploaderUserId),
    index("elo_upload_reports_uploaded_idx").on(table.uploadedAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  passwordSetupTokens: many(passwordSetupTokens),
  sessions: many(sessions),
  replays: many(replays),
  uploadLeases: many(uploadLeases),
  uploadEvents: many(uploadEvents),
  analysisFeedback: many(analysisFeedback),
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
  analysis: one(replayAnalyses, {
    fields: [replays.id],
    references: [replayAnalyses.replayId],
  }),
  decisionObservations: many(decisionObservations),
  handAnalyses: many(handAnalyses),
  analysisFeedback: many(analysisFeedback),
  decisionDatasetExamples: many(decisionDatasetExamples),
}));

export const replayMetricsRelations = relations(replayMetrics, ({ one }) => ({
  replay: one(replays, {
    fields: [replayMetrics.replayId],
    references: [replays.id],
  }),
}));

export const analysisModelVersionsRelations = relations(analysisModelVersions, ({ many }) => ({
  replayAnalyses: many(replayAnalyses),
  handAnalyses: many(handAnalyses),
  decisionDatasetExamples: many(decisionDatasetExamples),
}));

export const replayAnalysesRelations = relations(replayAnalyses, ({ one }) => ({
  replay: one(replays, {
    fields: [replayAnalyses.replayId],
    references: [replays.id],
  }),
  modelVersion: one(analysisModelVersions, {
    fields: [replayAnalyses.modelVersionId],
    references: [analysisModelVersions.id],
  }),
}));

export const decisionObservationsRelations = relations(decisionObservations, ({ one, many }) => ({
  replay: one(replays, {
    fields: [decisionObservations.replayId],
    references: [replays.id],
  }),
  handAnalyses: many(handAnalyses),
}));

export const handAnalysesRelations = relations(handAnalyses, ({ one }) => ({
  replay: one(replays, {
    fields: [handAnalyses.replayId],
    references: [replays.id],
  }),
  observation: one(decisionObservations, {
    fields: [handAnalyses.observationId],
    references: [decisionObservations.id],
  }),
  modelVersion: one(analysisModelVersions, {
    fields: [handAnalyses.modelVersionId],
    references: [analysisModelVersions.id],
  }),
}));

export const analysisFeedbackRelations = relations(analysisFeedback, ({ one }) => ({
  replay: one(replays, {
    fields: [analysisFeedback.replayId],
    references: [replays.id],
  }),
  user: one(users, {
    fields: [analysisFeedback.userId],
    references: [users.id],
  }),
}));

export const decisionDatasetExamplesRelations = relations(decisionDatasetExamples, ({ one }) => ({
  replay: one(replays, {
    fields: [decisionDatasetExamples.replayId],
    references: [replays.id],
  }),
  modelVersion: one(analysisModelVersions, {
    fields: [decisionDatasetExamples.modelVersionId],
    references: [analysisModelVersions.id],
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

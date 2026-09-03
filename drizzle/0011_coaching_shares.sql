CREATE TABLE `replay_shares` (
  `id` text PRIMARY KEY NOT NULL,
  `replay_id` integer NOT NULL REFERENCES `replays`(`id`) ON DELETE CASCADE,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL,
  `coach_name` text NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer,
  `include_analysis` integer NOT NULL DEFAULT 0,
  `include_note` integer NOT NULL DEFAULT 0,
  `include_bookmarks` integer NOT NULL DEFAULT 0,
  `include_goals` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replay_shares_token_hash_unique` ON `replay_shares` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `replay_shares_replay_active_idx` ON `replay_shares` (`replay_id`, `revoked_at`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `coaching_threads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` text NOT NULL REFERENCES `replay_shares`(`id`) ON DELETE CASCADE,
  `replay_id` integer NOT NULL REFERENCES `replays`(`id`) ON DELETE CASCADE,
  `frame_index` integer NOT NULL,
  `title` text,
  `resolved_at` integer,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `coaching_threads_share_frame_idx` ON `coaching_threads` (`share_id`, `frame_index`);
--> statement-breakpoint
CREATE TABLE `coaching_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` integer NOT NULL REFERENCES `coaching_threads`(`id`) ON DELETE CASCADE,
  `author_role` text NOT NULL CHECK (`author_role` IN ('coach', 'player')),
  `body` text NOT NULL,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `coaching_messages_thread_created_idx` ON `coaching_messages` (`thread_id`, `created_at`);

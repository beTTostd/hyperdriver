CREATE TABLE `training_goals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `origin` text NOT NULL CHECK (`origin` IN ('manual', 'analysis_pattern')),
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'achieved', 'not_achieved', 'cancelled')),
  `game_mode` text,
  `hero_id` text,
  `target_matches` integer NOT NULL DEFAULT 10,
  `progress_matches` integer NOT NULL DEFAULT 0,
  `source_replay_id` integer REFERENCES `replays`(`id`) ON DELETE SET NULL,
  `pattern_tag` text,
  `baseline_replay_count` integer,
  `baseline_occurrences` integer,
  `baseline_decisions` integer,
  `baseline_rate` real,
  `target_rate` real,
  `current_occurrences` integer,
  `current_decisions` integer,
  `current_rate` real,
  `result_reduction` real,
  `started_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `completed_at` integer,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `training_goals_user_status_idx` ON `training_goals` (`user_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `training_goals_source_replay_idx` ON `training_goals` (`source_replay_id`);
--> statement-breakpoint
CREATE TABLE `training_goal_checkins` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `training_goals`(`id`) ON DELETE CASCADE,
  `replay_id` integer REFERENCES `replays`(`id`) ON DELETE SET NULL,
  `state` text NOT NULL CHECK (`state` IN ('met', 'not_met')),
  `note` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_goal_checkins_goal_replay_unique` ON `training_goal_checkins` (`goal_id`, `replay_id`);
--> statement-breakpoint
CREATE INDEX `training_goal_checkins_replay_idx` ON `training_goal_checkins` (`replay_id`);

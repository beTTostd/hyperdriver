CREATE TABLE `analysis_model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_schema` text NOT NULL,
	`evaluator_version` text NOT NULL,
	`card_catalog_version` text NOT NULL,
	`rules_version` text NOT NULL,
	`talishar_commit` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replay_analyses` (
	`replay_id` integer PRIMARY KEY NOT NULL,
	`model_version_id` text,
	`status` text NOT NULL,
	`observation_count` integer DEFAULT 0 NOT NULL,
	`analysis_count` integer DEFAULT 0 NOT NULL,
	`summary_json` text,
	`methodology_json` text,
	`error_code` text,
	`queued_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`analyzed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_version_id`) REFERENCES `analysis_model_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `replay_analyses_status_check` CHECK (`status` IN ('pending', 'ready', 'insufficient_data', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `replay_analyses_status_idx` ON `replay_analyses` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `decision_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`replay_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`frame_sequence` integer NOT NULL,
	`frame_index` integer NOT NULL,
	`turn` integer,
	`kind` text NOT NULL,
	`state_fingerprint` text NOT NULL,
	`hand_fingerprint` text NOT NULL,
	`data_quality` text NOT NULL,
	`state_json` text NOT NULL,
	`legal_actions_json` text NOT NULL,
	`chosen_action_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `decision_observations_quality_check` CHECK (`data_quality` IN ('captured', 'inferred', 'insufficient'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_observations_replay_ordinal_unique` ON `decision_observations` (`replay_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `decision_observations_fingerprint_idx` ON `decision_observations` (`state_fingerprint`);
--> statement-breakpoint
CREATE INDEX `decision_observations_replay_kind_idx` ON `decision_observations` (`replay_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `hand_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`replay_id` integer NOT NULL,
	`observation_id` integer NOT NULL,
	`model_version_id` text NOT NULL,
	`state_fingerprint` text NOT NULL,
	`frame_sequence` integer NOT NULL,
	`frame_index` integer NOT NULL,
	`turn` integer,
	`decision_kind` text NOT NULL,
	`marker` text,
	`confidence` text NOT NULL,
	`hand_potential` real NOT NULL,
	`execution_quality` real NOT NULL,
	`chosen_value` real NOT NULL,
	`best_value` real NOT NULL,
	`regret_pp` real NOT NULL,
	`tags_json` text NOT NULL,
	`analysis_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `decision_observations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_version_id`) REFERENCES `analysis_model_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `hand_analyses_marker_check` CHECK (`marker` IS NULL OR `marker` IN ('good', 'opportunity', 'high_impact_error')),
	CONSTRAINT `hand_analyses_confidence_check` CHECK (`confidence` IN ('high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hand_analyses_observation_model_unique` ON `hand_analyses` (`observation_id`,`model_version_id`);
--> statement-breakpoint
CREATE INDEX `hand_analyses_replay_frame_idx` ON `hand_analyses` (`replay_id`,`frame_sequence`);
--> statement-breakpoint
CREATE INDEX `hand_analyses_replay_marker_idx` ON `hand_analyses` (`replay_id`,`marker`);
--> statement-breakpoint
CREATE TABLE `analysis_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`replay_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`analysis_fingerprint` text NOT NULL,
	`helpful` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `analysis_feedback_helpful_check` CHECK (`helpful` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_feedback_user_analysis_unique` ON `analysis_feedback` (`user_id`,`replay_id`,`analysis_fingerprint`);
--> statement-breakpoint
CREATE INDEX `analysis_feedback_replay_idx` ON `analysis_feedback` (`replay_id`);
--> statement-breakpoint
CREATE TABLE `decision_dataset_examples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`replay_id` integer NOT NULL,
	`model_version_id` text NOT NULL,
	`example_key` text NOT NULL,
	`user_cohort` text NOT NULL,
	`decision_kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_version_id`) REFERENCES `analysis_model_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_dataset_examples_key_unique` ON `decision_dataset_examples` (`example_key`);
--> statement-breakpoint
CREATE INDEX `decision_dataset_examples_replay_idx` ON `decision_dataset_examples` (`replay_id`);
--> statement-breakpoint
CREATE INDEX `decision_dataset_examples_cohort_idx` ON `decision_dataset_examples` (`user_cohort`,`created_at`);

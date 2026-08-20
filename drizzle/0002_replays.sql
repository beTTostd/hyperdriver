CREATE TABLE `replays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source_match_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`schema_version` text NOT NULL,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`player_hero_id` text,
	`opponent_hero_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`final_turn` integer,
	`frame_count` integer NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replays_source_match_unique` ON `replays` (`source_match_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `replays_storage_key_unique` ON `replays` (`storage_key`);
--> statement-breakpoint
CREATE INDEX `replays_user_uploaded_idx` ON `replays` (`user_id`,`uploaded_at`);

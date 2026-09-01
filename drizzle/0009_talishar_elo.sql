CREATE TABLE `talishar_players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `talishar_players_normalized_name_unique` ON `talishar_players` (`normalized_name`);
--> statement-breakpoint
CREATE TABLE `elo_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`format` text NOT NULL,
	`rating` real DEFAULT 1000 NOT NULL,
	`games` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `talishar_players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `elo_ratings_player_format_unique` ON `elo_ratings` (`player_id`,`format`);
--> statement-breakpoint
CREATE INDEX `elo_ratings_format_rank_idx` ON `elo_ratings` (`format`,`rating`);
--> statement-breakpoint
CREATE TABLE `elo_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_guid` text NOT NULL,
	`format` text NOT NULL,
	`winner_player_id` integer NOT NULL,
	`loser_player_id` integer NOT NULL,
	`winner_rating_before` real NOT NULL,
	`loser_rating_before` real NOT NULL,
	`rating_change` real NOT NULL,
	`status` text DEFAULT 'unconfirmed' NOT NULL,
	`first_uploader_user_id` integer NOT NULL,
	`first_source_match_id` text NOT NULL,
	`conflict_reason` text,
	`scored_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer,
	`conflict_at` integer,
	FOREIGN KEY (`winner_player_id`) REFERENCES `talishar_players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`loser_player_id`) REFERENCES `talishar_players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `elo_matches_status_check` CHECK (`status` IN ('unconfirmed', 'confirmed', 'conflict'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `elo_matches_game_guid_unique` ON `elo_matches` (`game_guid`);
--> statement-breakpoint
CREATE INDEX `elo_matches_conflict_idx` ON `elo_matches` (`status`,`conflict_at`);
--> statement-breakpoint
CREATE TABLE `elo_upload_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`elo_match_id` integer,
	`game_guid` text,
	`source_match_id` text NOT NULL,
	`uploader_user_id` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`format` text,
	`player_name` text,
	`opponent_name` text,
	`winner_name` text,
	`uploaded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`elo_match_id`) REFERENCES `elo_matches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `elo_upload_reports_status_check` CHECK (`status` IN ('applied', 'confirmed', 'duplicate', 'conflict', 'ignored'))
);
--> statement-breakpoint
CREATE INDEX `elo_upload_reports_match_uploader_idx` ON `elo_upload_reports` (`elo_match_id`,`uploader_user_id`);
--> statement-breakpoint
CREATE INDEX `elo_upload_reports_uploaded_idx` ON `elo_upload_reports` (`uploaded_at`);

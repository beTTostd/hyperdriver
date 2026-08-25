CREATE TABLE `upload_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_id` integer NOT NULL,
	`source_match_id` text,
	`category` text NOT NULL,
	`http_status` integer NOT NULL,
	`error_code` text,
	`technical_message` text,
	`replay_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `upload_events_attempted_idx` ON `upload_events` (`attempted_at`);
--> statement-breakpoint
CREATE INDEX `upload_events_category_attempted_idx` ON `upload_events` (`category`,`attempted_at`);
--> statement-breakpoint
CREATE INDEX `upload_events_user_attempted_idx` ON `upload_events` (`user_id`,`attempted_at`);
--> statement-breakpoint
INSERT INTO `upload_events` (
	`attempted_at`, `user_id`, `source_match_id`, `category`, `http_status`, `replay_id`
)
SELECT `uploaded_at`, `user_id`, `source_match_id`, 'success', 201, `id`
FROM `replays`
WHERE `uploaded_at` >= (unixepoch() * 1000 - 7 * 24 * 60 * 60 * 1000);

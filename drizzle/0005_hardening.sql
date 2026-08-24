ALTER TABLE `replays` ADD `size_bytes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `replay_metrics` (
	`replay_id` integer PRIMARY KEY NOT NULL,
	`received_damage` integer DEFAULT 0 NOT NULL,
	`equipment_blocked` integer DEFAULT 0 NOT NULL,
	`card_blocked` integer DEFAULT 0 NOT NULL,
	`offered_damage` integer DEFAULT 0 NOT NULL,
	`life_gained` integer DEFAULT 0 NOT NULL,
	`cycle_count` integer DEFAULT 0 NOT NULL,
	`calculated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket` text NOT NULL,
	`identity` text NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_events_lookup_idx` ON `rate_limit_events` (`bucket`,`identity`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `rate_limit_events_expiry_idx` ON `rate_limit_events` (`occurred_at`);
--> statement-breakpoint
CREATE TABLE `upload_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `upload_leases_user_expiry_idx` ON `upload_leases` (`user_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `replays_user_started_id_idx` ON `replays` (`user_id`,`started_at`,`id`);

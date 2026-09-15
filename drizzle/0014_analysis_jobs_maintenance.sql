CREATE TABLE `analysis_jobs` (
	`replay_id` integer PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`replay_id`) REFERENCES `replays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analysis_jobs_claim_idx` ON `analysis_jobs` (`status`,`available_at`,`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `maintenance_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `analysis_jobs` (`replay_id`, `status`, `attempts`, `available_at`, `created_at`, `updated_at`, `completed_at`)
SELECT `replay_id`,
  CASE WHEN `status` IN ('ready', 'insufficient_data') THEN 'ready' WHEN `status` = 'failed' THEN 'failed' ELSE 'pending' END,
  CASE WHEN `status` = 'failed' THEN 1 ELSE 0 END,
  `queued_at`, `queued_at`, `updated_at`,
  CASE WHEN `status` IN ('ready', 'insufficient_data') THEN COALESCE(`analyzed_at`, `updated_at`) ELSE NULL END
FROM `replay_analyses`;

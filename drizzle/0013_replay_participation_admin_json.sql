ALTER TABLE `replays` ADD `participation` text NOT NULL DEFAULT 'unknown' CHECK (`participation` IN ('played', 'watched', 'unknown'));
--> statement-breakpoint
ALTER TABLE `replays` ADD `participation_source` text CHECK (`participation_source` IN ('automatic', 'manual'));
--> statement-breakpoint
CREATE TABLE `admin_json_files` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `admin_user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `original_name` text NOT NULL,
  `storage_key` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `uploaded_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_json_files_storage_key_unique` ON `admin_json_files` (`storage_key`);
--> statement-breakpoint
CREATE INDEX `admin_json_files_uploaded_idx` ON `admin_json_files` (`uploaded_at`);
--> statement-breakpoint
CREATE INDEX `admin_json_files_admin_idx` ON `admin_json_files` (`admin_user_id`, `uploaded_at`);

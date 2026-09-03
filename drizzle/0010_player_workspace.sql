CREATE TABLE `replay_workspace` (
  `replay_id` integer PRIMARY KEY NOT NULL REFERENCES `replays`(`id`) ON DELETE CASCADE,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `note` text NOT NULL DEFAULT '',
  `is_favorite` integer NOT NULL DEFAULT 0,
  `reviewed_at` integer,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `replay_workspace_user_favorite_idx` ON `replay_workspace` (`user_id`, `is_favorite`);
--> statement-breakpoint
CREATE INDEX `replay_workspace_user_reviewed_idx` ON `replay_workspace` (`user_id`, `reviewed_at`);
--> statement-breakpoint
CREATE TABLE `user_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_tags_user_name_unique` ON `user_tags` (`user_id`, `normalized_name`);
--> statement-breakpoint
CREATE TABLE `replay_tags` (
  `replay_id` integer NOT NULL REFERENCES `replays`(`id`) ON DELETE CASCADE,
  `tag_id` integer NOT NULL REFERENCES `user_tags`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`replay_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `replay_tags_tag_idx` ON `replay_tags` (`tag_id`, `replay_id`);
--> statement-breakpoint
CREATE TABLE `replay_bookmarks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `replay_id` integer NOT NULL REFERENCES `replays`(`id`) ON DELETE CASCADE,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `frame_index` integer NOT NULL,
  `title` text NOT NULL,
  `note` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `replay_bookmarks_replay_frame_idx` ON `replay_bookmarks` (`replay_id`, `frame_index`);

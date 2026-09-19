CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`url` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`sha256` text,
	`status` text NOT NULL,
	`source_page` text,
	`alt` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `downloads_task_idx` ON `downloads` (`task_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`error` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_events_task_sequence_idx` ON `task_events` (`task_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`goal` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	`step_count` integer DEFAULT 0 NOT NULL,
	`downloads_count` integer DEFAULT 0 NOT NULL,
	`current_url` text
);

CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`folder_name` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`namespace` text,
	`author` text,
	`tags` text,
	`content_hash` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_folder_name_unique` ON `skills` (`folder_name`);--> statement-breakpoint
CREATE INDEX `idx_skills_source` ON `skills` (`source`);--> statement-breakpoint
CREATE INDEX `idx_skills_is_enabled` ON `skills` (`is_enabled`);
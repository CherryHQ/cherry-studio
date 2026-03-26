CREATE TABLE `skill` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`author` text,
	`version` text,
	`tags` text,
	`tools` text,
	`source` text NOT NULL,
	`source_path` text NOT NULL,
	`package_name` text,
	`package_version` text,
	`marketplace_id` text,
	`content_hash` text,
	`size` integer,
	`is_enabled` integer DEFAULT true NOT NULL,
	`version_dir_path` text,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "skill_source_check" CHECK("skill"."source" IN ('builtin', 'project', 'marketplace', 'local', 'zip'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_slug_unique` ON `skill` (`slug`);--> statement-breakpoint
CREATE INDEX `skill_name_idx` ON `skill` (`name`);--> statement-breakpoint
CREATE INDEX `skill_source_idx` ON `skill` (`source`);--> statement-breakpoint
CREATE INDEX `skill_is_enabled_idx` ON `skill` (`is_enabled`);--> statement-breakpoint
CREATE TABLE `skill_version` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`version` text,
	`content_hash` text NOT NULL,
	`diff_path` text NOT NULL,
	`message` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_version_skill_id_idx` ON `skill_version` (`skill_id`,`created_at`);
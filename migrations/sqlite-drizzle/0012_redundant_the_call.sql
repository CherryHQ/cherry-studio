PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents_skills` (
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
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_agents_skills`("id", "name", "description", "folder_name", "source", "source_url", "namespace", "author", "tags", "content_hash", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "description", "folder_name", "source", "source_url", "namespace", "author", "tags", "content_hash", "is_enabled", "created_at", "updated_at" FROM `agents_skills`;--> statement-breakpoint
DROP TABLE `agents_skills`;--> statement-breakpoint
ALTER TABLE `__new_agents_skills` RENAME TO `agents_skills`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_skills_folder_name_unique` ON `agents_skills` (`folder_name`);--> statement-breakpoint
CREATE INDEX `agents_skills_source_idx` ON `agents_skills` (`source`);--> statement-breakpoint
CREATE INDEX `agents_skills_is_enabled_idx` ON `agents_skills` (`is_enabled`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '',
	`emoji` text,
	`description` text DEFAULT '',
	`settings` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_assistant`("id", "name", "prompt", "emoji", "description", "settings", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "prompt", "emoji", "description", "settings", "created_at", "updated_at", "deleted_at" FROM `assistant`;--> statement-breakpoint
DROP TABLE `assistant`;--> statement-breakpoint
ALTER TABLE `__new_assistant` RENAME TO `assistant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `message` ADD `assistant_id` text REFERENCES assistant(id);--> statement-breakpoint
ALTER TABLE `message` ADD `assistant_snapshot` text;--> statement-breakpoint
ALTER TABLE `message` ADD `model_snapshot` text;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `model_meta`;--> statement-breakpoint
ALTER TABLE `assistant_knowledge_base` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `assistant_mcp_server` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `assistant_model` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `prompt`;
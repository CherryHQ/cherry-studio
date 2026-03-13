DROP INDEX `prompt_version_prompt_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_version_prompt_id_version_idx` ON `prompt_version` (`prompt_id`,`version`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_prompt`("id", "title", "content", "current_version", "sort_order", "created_at", "updated_at") SELECT "id", "title", "content", "current_version", "sort_order", "created_at", "updated_at" FROM `prompt`;--> statement-breakpoint
DROP TABLE `prompt`;--> statement-breakpoint
ALTER TABLE `__new_prompt` RENAME TO `prompt`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `prompt_sort_order_idx` ON `prompt` (`sort_order`);--> statement-breakpoint
CREATE INDEX `prompt_updated_at_idx` ON `prompt` (`updated_at`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`visibility` text DEFAULT 'global' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "prompt_visibility_check" CHECK("__new_prompt"."visibility" IN ('global', 'restricted'))
);
--> statement-breakpoint
INSERT INTO `__new_prompt`("id", "title", "content", "visibility", "order_key", "created_at", "updated_at") SELECT "id", "title", "content", "visibility", "order_key", "created_at", "updated_at" FROM `prompt`;--> statement-breakpoint
DROP TABLE `prompt`;--> statement-breakpoint
ALTER TABLE `__new_prompt` RENAME TO `prompt`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `prompt_order_key_idx` ON `prompt` (`order_key`);
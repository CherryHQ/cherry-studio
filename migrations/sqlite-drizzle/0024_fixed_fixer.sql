PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`emoji` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`model_id` text,
	`group_id` text,
	`settings` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_assistant`("id", "name", "prompt", "emoji", "description", "model_id", "group_id", "settings", "order_key", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "prompt", "emoji", "description", "model_id", "group_id", "settings", "order_key", "created_at", "updated_at", "deleted_at" FROM `assistant`;--> statement-breakpoint
DROP TABLE `assistant`;--> statement-breakpoint
ALTER TABLE `__new_assistant` RENAME TO `assistant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assistant_created_at_idx` ON `assistant` (`created_at`);--> statement-breakpoint
CREATE INDEX `assistant_order_key_idx` ON `assistant` (`order_key`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text NOT NULL,
	`model` text,
	`plan_model` text,
	`small_model` text,
	`disabled_tools` text DEFAULT '[]' NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`group_id` text,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`small_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent`("id", "type", "name", "description", "instructions", "model", "plan_model", "small_model", "disabled_tools", "configuration", "order_key", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "name", "description", "instructions", "model", "plan_model", "small_model", "disabled_tools", "configuration", "order_key", "created_at", "updated_at", "deleted_at" FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
CREATE INDEX `agent_order_key_idx` ON `agent` (`order_key`);

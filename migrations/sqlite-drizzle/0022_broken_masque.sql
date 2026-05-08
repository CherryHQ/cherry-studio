PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`accessible_paths` text DEFAULT '[]' NOT NULL,
	`instructions` text NOT NULL,
	`model` text,
	`plan_model` text,
	`small_model` text,
	`mcps` text DEFAULT '[]' NOT NULL,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`small_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent`("id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "order_key", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", '' AS "order_key", "created_at", "updated_at", "deleted_at" FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
CREATE INDEX `agent_order_key_idx` ON `agent` (`order_key`);--> statement-breakpoint
DROP INDEX `agent_session_agent_id_idx`;--> statement-breakpoint
DROP INDEX `agent_session_model_idx`;--> statement-breakpoint
DROP INDEX `agent_session_sort_order_idx`;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `order_key` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `agent_session_agent_id_order_key_idx` ON `agent_session` (`agent_id`,`order_key`);--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `agent_type`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `accessible_paths`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `instructions`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `plan_model`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `small_model`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `mcps`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `allowed_tools`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `slash_commands`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `configuration`;--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `sort_order`;
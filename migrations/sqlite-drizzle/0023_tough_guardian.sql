PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_session` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`accessible_paths` text DEFAULT '[]' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_session`("id", "agent_id", "name", "description", "accessible_paths", "order_key", "created_at", "updated_at") SELECT "id", "agent_id", "name", "description", "accessible_paths", "order_key", "created_at", "updated_at" FROM `agent_session`;--> statement-breakpoint
DROP TABLE `agent_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_session` RENAME TO `agent_session`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_session_order_key_idx` ON `agent_session` (`order_key`);--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text NOT NULL,
	`model` text,
	`plan_model` text,
	`small_model` text,
	`mcps` text DEFAULT '[]' NOT NULL,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`small_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent`("id", "type", "name", "description", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "name", "description", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "created_at", "updated_at", "deleted_at" FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
-- Strip v1 fields from assistant.settings JSON.
-- `qwenThinkMode` is redundant (replaced by `reasoning_effort !== undefined`);
-- `contextCount` is replaced by reading `model.contextWindow` at runtime.
-- Both were removed from the v2 AssistantSettings Zod schema, so any row that
-- still carries them would fail strict parses on subsequent PATCH paths.
UPDATE `assistant`
SET `settings` = json_remove(`settings`, '$.qwenThinkMode', '$.contextCount')
WHERE `settings` IS NOT NULL
  AND (json_extract(`settings`, '$.qwenThinkMode') IS NOT NULL
       OR json_extract(`settings`, '$.contextCount') IS NOT NULL);

PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `order_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
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
CREATE TABLE `__new_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`emoji` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`model_id` text,
	`settings` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
WITH `ordered_assistant` AS (
	SELECT
		"id",
		"name",
		"prompt",
		"emoji",
		"description",
		"model_id",
		"settings",
		"created_at",
		"updated_at",
		"deleted_at",
		ROW_NUMBER() OVER (ORDER BY "created_at", "id") - 1 AS "order_index"
	FROM `assistant`
),
`base62_digits` AS (
	SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS "digits"
),
`assistant_with_order_key` AS (
	SELECT
		"id",
		"name",
		"prompt",
		"emoji",
		"description",
		"model_id",
		"settings",
		CASE
			WHEN "order_index" < 62 THEN
				'a' || substr("digits", "order_index" + 1, 1)
			WHEN "order_index" < 3906 THEN
				'b' ||
				substr("digits", CAST(("order_index" - 62) / 62 AS INTEGER) + 1, 1) ||
				substr("digits", (("order_index" - 62) % 62) + 1, 1)
			WHEN "order_index" < 242234 THEN
				'c' ||
				substr("digits", CAST(("order_index" - 3906) / 3844 AS INTEGER) + 1, 1) ||
				substr("digits", (CAST(("order_index" - 3906) / 62 AS INTEGER) % 62) + 1, 1) ||
				substr("digits", (("order_index" - 3906) % 62) + 1, 1)
			ELSE
				'd' ||
				substr("digits", CAST(("order_index" - 242234) / 238328 AS INTEGER) + 1, 1) ||
				substr("digits", (CAST(("order_index" - 242234) / 3844 AS INTEGER) % 62) + 1, 1) ||
				substr("digits", (CAST(("order_index" - 242234) / 62 AS INTEGER) % 62) + 1, 1) ||
				substr("digits", (("order_index" - 242234) % 62) + 1, 1)
		END AS "order_key",
		"created_at",
		"updated_at",
		"deleted_at"
	FROM `ordered_assistant`, `base62_digits`
)
INSERT INTO `__new_assistant`("id", "name", "prompt", "emoji", "description", "model_id", "settings", "order_key", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "prompt", "emoji", "description", "model_id", "settings", "order_key", "created_at", "updated_at", "deleted_at" FROM `assistant_with_order_key`;--> statement-breakpoint
DROP TABLE `assistant`;--> statement-breakpoint
ALTER TABLE `__new_assistant` RENAME TO `assistant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_session_order_key_idx` ON `agent_session` (`order_key`);--> statement-breakpoint
CREATE INDEX `assistant_created_at_idx` ON `assistant` (`created_at`);--> statement-breakpoint
CREATE INDEX `assistant_order_key_idx` ON `assistant` (`order_key`);--> statement-breakpoint
DROP INDEX `topic_group_id_order_key_idx`;--> statement-breakpoint
CREATE INDEX `topic_order_key_idx` ON `topic` (`order_key`);--> statement-breakpoint
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

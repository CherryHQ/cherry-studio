DROP INDEX `message_trace_id_idx`;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `trace_id`;--> statement-breakpoint
DROP INDEX `topic_group_id_order_key_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `trace_id` text;--> statement-breakpoint
CREATE INDEX `topic_order_key_idx` ON `topic` (`order_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`type` text DEFAULT 'user' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "agent_workspace_type_check" CHECK("__new_agent_workspace"."type" IN ('user', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_workspace`("id", "name", "path", "type", "order_key", "created_at", "updated_at") SELECT "id", "name", "path", "type", "order_key", "created_at", "updated_at" FROM `agent_workspace`;--> statement-breakpoint
DROP TABLE `agent_workspace`;--> statement-breakpoint
ALTER TABLE `__new_agent_workspace` RENAME TO `agent_workspace`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_workspace_path_unique_idx` ON `agent_workspace` (`path`);--> statement-breakpoint
CREATE INDEX `agent_workspace_order_key_idx` ON `agent_workspace` (`order_key`);--> statement-breakpoint
CREATE TABLE `__new_user_provider` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`preset_provider_id` text,
	`name` text NOT NULL,
	`endpoint_configs` text,
	`default_chat_endpoint` text,
	`api_keys` text DEFAULT '[]',
	`auth_config` text,
	`api_features` text,
	`provider_settings` text,
	`is_enabled` integer DEFAULT false NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_provider`("provider_id", "preset_provider_id", "name", "endpoint_configs", "default_chat_endpoint", "api_keys", "auth_config", "api_features", "provider_settings", "is_enabled", "order_key", "created_at", "updated_at") SELECT "provider_id", "preset_provider_id", "name", "endpoint_configs", "default_chat_endpoint", "api_keys", "auth_config", "api_features", "provider_settings", "is_enabled", "order_key", "created_at", "updated_at" FROM `user_provider`;--> statement-breakpoint
DROP TABLE `user_provider`;--> statement-breakpoint
ALTER TABLE `__new_user_provider` RENAME TO `user_provider`;--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_idx` ON `user_provider` (`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_provider_order_key_idx` ON `user_provider` (`order_key`);--> statement-breakpoint
ALTER TABLE `agent` ADD `disabled_tools` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent` DROP COLUMN `allowed_tools`;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `assistant` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_session_message` DROP COLUMN `trace_id`;
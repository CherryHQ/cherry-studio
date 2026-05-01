ALTER TABLE `miniapp` RENAME TO `mini_app`;--> statement-breakpoint
ALTER TABLE `mini_app` RENAME COLUMN "type" TO "kind";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`kind` text DEFAULT 'custom' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("__new_mini_app"."status" IN ('enabled', 'disabled', 'pinned')),
	CONSTRAINT "mini_app_kind_check" CHECK("__new_mini_app"."kind" IN ('default', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_mini_app`("app_id", "name", "url", "logo", "kind", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "name", "url", "logo", "kind", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `mini_app`;--> statement-breakpoint
DROP TABLE `mini_app`;--> statement-breakpoint
ALTER TABLE `__new_mini_app` RENAME TO `mini_app`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mini_app_status_sort_idx` ON `mini_app` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `mini_app_kind_idx` ON `mini_app` (`kind`);--> statement-breakpoint
CREATE INDEX `mini_app_status_kind_idx` ON `mini_app` (`status`,`kind`);--> statement-breakpoint
CREATE TABLE `__new_topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_name_manually_edited` integer DEFAULT false NOT NULL,
	`assistant_id` text,
	`active_node_id` text,
	`group_id` text,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_topic`("id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "group_id", "order_key", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "group_id", "order_key", "created_at", "updated_at", "deleted_at" FROM `topic`;--> statement-breakpoint
DROP TABLE `topic`;--> statement-breakpoint
ALTER TABLE `__new_topic` RENAME TO `topic`;--> statement-breakpoint
CREATE INDEX `topic_group_updated_idx` ON `topic` (`group_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_group_id_order_key_idx` ON `topic` (`group_id`,`order_key`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`accessible_paths` text DEFAULT '[]' NOT NULL,
	`instructions` text NOT NULL,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`mcps` text DEFAULT '[]' NOT NULL,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_agent`("id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "sort_order", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "sort_order", "created_at", "updated_at", "deleted_at" FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
CREATE INDEX `agent_sort_order_idx` ON `agent` (`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_agent_global_skill` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`folder_name` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`namespace` text,
	`author` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`content_hash` text NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agent_global_skill`("id", "name", "description", "folder_name", "source", "source_url", "namespace", "author", "tags", "content_hash", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "description", "folder_name", "source", "source_url", "namespace", "author", "tags", "content_hash", "is_enabled", "created_at", "updated_at" FROM `agent_global_skill`;--> statement-breakpoint
DROP TABLE `agent_global_skill`;--> statement-breakpoint
ALTER TABLE `__new_agent_global_skill` RENAME TO `agent_global_skill`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_global_skill_folder_name_unique` ON `agent_global_skill` (`folder_name`);--> statement-breakpoint
CREATE INDEX `agent_global_skill_source_idx` ON `agent_global_skill` (`source`);--> statement-breakpoint
CREATE INDEX `agent_global_skill_is_enabled_idx` ON `agent_global_skill` (`is_enabled`);--> statement-breakpoint
CREATE TABLE `__new_agent_session` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_type` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`accessible_paths` text DEFAULT '[]' NOT NULL,
	`instructions` text NOT NULL,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`mcps` text DEFAULT '[]' NOT NULL,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`slash_commands` text DEFAULT '[]' NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_session`("id", "agent_type", "agent_id", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "slash_commands", "configuration", "sort_order", "created_at", "updated_at") SELECT "id", "agent_type", "agent_id", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "slash_commands", "configuration", "sort_order", "created_at", "updated_at" FROM `agent_session`;--> statement-breakpoint
DROP TABLE `agent_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_session` RENAME TO `agent_session`;--> statement-breakpoint
CREATE INDEX `agent_session_agent_id_idx` ON `agent_session` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_session_model_idx` ON `agent_session` (`model`);--> statement-breakpoint
CREATE INDEX `agent_session_sort_order_idx` ON `agent_session` (`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_agent_task` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_value` text NOT NULL,
	`timeout_minutes` integer DEFAULT 2 NOT NULL,
	`next_run` integer,
	`last_run` integer,
	`last_result` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_task_schedule_type_check" CHECK("__new_agent_task"."schedule_type" IN ('cron', 'interval', 'once')),
	CONSTRAINT "agent_task_status_check" CHECK("__new_agent_task"."status" IN ('active', 'paused', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_task`("id", "agent_id", "name", "prompt", "schedule_type", "schedule_value", "timeout_minutes", "next_run", "last_run", "last_result", "status", "created_at", "updated_at") SELECT "id", "agent_id", "name", "prompt", "schedule_type", "schedule_value", "timeout_minutes", "next_run", "last_run", "last_result", "status", "created_at", "updated_at" FROM `agent_task`;--> statement-breakpoint
DROP TABLE `agent_task`;--> statement-breakpoint
ALTER TABLE `__new_agent_task` RENAME TO `agent_task`;--> statement-breakpoint
CREATE INDEX `agent_task_agent_id_idx` ON `agent_task` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_task_next_run_idx` ON `agent_task` (`next_run`);--> statement-breakpoint
CREATE INDEX `agent_task_status_idx` ON `agent_task` (`status`);--> statement-breakpoint
CREATE TABLE `__new_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`emoji` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`model_id` text,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_assistant`("id", "name", "prompt", "emoji", "description", "model_id", "settings", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "prompt", "emoji", "description", "model_id", "settings", "created_at", "updated_at", "deleted_at" FROM `assistant`;--> statement-breakpoint
DROP TABLE `assistant`;--> statement-breakpoint
ALTER TABLE `__new_assistant` RENAME TO `assistant`;--> statement-breakpoint
CREATE INDEX `assistant_created_at_idx` ON `assistant` (`created_at`);--> statement-breakpoint
CREATE TABLE `__new_message` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`data` text NOT NULL,
	`searchable_text` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`siblings_group_id` integer DEFAULT 0 NOT NULL,
	`model_id` text,
	`model_snapshot` text,
	`trace_id` text,
	`stats` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "message_role_check" CHECK("__new_message"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "message_status_check" CHECK("__new_message"."status" IN ('pending', 'success', 'error', 'paused'))
);
--> statement-breakpoint
INSERT INTO `__new_message`("id", "parent_id", "topic_id", "role", "data", "searchable_text", "status", "siblings_group_id", "model_id", "model_snapshot", "trace_id", "stats", "created_at", "updated_at", "deleted_at") SELECT "id", "parent_id", "topic_id", "role", "data", "searchable_text", "status", "siblings_group_id", "model_id", "model_snapshot", "trace_id", "stats", "created_at", "updated_at", "deleted_at" FROM `message`;--> statement-breakpoint
DROP TABLE `message`;--> statement-breakpoint
ALTER TABLE `__new_message` RENAME TO `message`;--> statement-breakpoint
CREATE INDEX `message_parent_id_idx` ON `message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `message_topic_created_idx` ON `message` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_trace_id_idx` ON `message` (`trace_id`);
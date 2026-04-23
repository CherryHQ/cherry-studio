PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accessible_paths` text,
	`instructions` text,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`mcps` text,
	`allowed_tools` text,
	`configuration` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_agent`("id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "sort_order", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "sort_order", "created_at", "updated_at", "deleted_at" FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
CREATE INDEX `agent_sort_order_idx` ON `agent` (`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_agent_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`session_id` text,
	`config` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`active_chat_ids` text DEFAULT '[]',
	`permission_mode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_channel_type_check" CHECK("__new_agent_channel"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')),
	CONSTRAINT "agent_channel_permission_mode_check" CHECK("__new_agent_channel"."permission_mode" IS NULL OR "__new_agent_channel"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_channel`("id", "type", "name", "agent_id", "session_id", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at") SELECT "id", "type", "name", "agent_id", "session_id", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at" FROM `agent_channel`;--> statement-breakpoint
DROP TABLE `agent_channel`;--> statement-breakpoint
ALTER TABLE `__new_agent_channel` RENAME TO `agent_channel`;--> statement-breakpoint
CREATE INDEX `agent_channel_agent_id_idx` ON `agent_channel` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_type_idx` ON `agent_channel` (`type`);--> statement-breakpoint
CREATE INDEX `agent_channel_session_id_idx` ON `agent_channel` (`session_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_global_skill` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`folder_name` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`namespace` text,
	`author` text,
	`tags` text,
	`content_hash` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
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
	`description` text,
	`accessible_paths` text,
	`instructions` text,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`mcps` text,
	`allowed_tools` text,
	`slash_commands` text,
	`configuration` text,
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
CREATE TABLE `__new_agent_session_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`agent_session_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_session_message`("id", "session_id", "role", "content", "agent_session_id", "metadata", "created_at", "updated_at") SELECT "id", "session_id", "role", "content", "agent_session_id", "metadata", "created_at", "updated_at" FROM `agent_session_message`;--> statement-breakpoint
DROP TABLE `agent_session_message`;--> statement-breakpoint
ALTER TABLE `__new_agent_session_message` RENAME TO `agent_session_message`;--> statement-breakpoint
CREATE INDEX `agent_session_message_session_id_idx` ON `agent_session_message` (`session_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_skill` (
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `skill_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `agent_global_skill`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_skill`("agent_id", "skill_id", "is_enabled", "created_at", "updated_at") SELECT "agent_id", "skill_id", "is_enabled", "created_at", "updated_at" FROM `agent_skill`;--> statement-breakpoint
DROP TABLE `agent_skill`;--> statement-breakpoint
ALTER TABLE `__new_agent_skill` RENAME TO `agent_skill`;--> statement-breakpoint
CREATE INDEX `agent_skill_agent_id_idx` ON `agent_skill` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_skill_skill_id_idx` ON `agent_skill` (`skill_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_task_run_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text,
	`run_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `agent_task`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_task_run_log_status_check" CHECK("__new_agent_task_run_log"."status" IN ('running', 'success', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_task_run_log`("id", "task_id", "session_id", "run_at", "duration_ms", "status", "result", "error", "created_at", "updated_at") SELECT "id", "task_id", "session_id", "run_at", "duration_ms", "status", "result", "error", "created_at", "updated_at" FROM `agent_task_run_log`;--> statement-breakpoint
DROP TABLE `agent_task_run_log`;--> statement-breakpoint
ALTER TABLE `__new_agent_task_run_log` RENAME TO `agent_task_run_log`;--> statement-breakpoint
CREATE INDEX `agent_task_run_log_task_id_idx` ON `agent_task_run_log` (`task_id`);--> statement-breakpoint
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
	`status` text DEFAULT 'active' NOT NULL,
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
CREATE TABLE `__new_app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_app_state`("key", "value", "description", "created_at", "updated_at") SELECT "key", "value", "description", "created_at", "updated_at" FROM `app_state`;--> statement-breakpoint
DROP TABLE `app_state`;--> statement-breakpoint
ALTER TABLE `__new_app_state` RENAME TO `app_state`;--> statement-breakpoint
CREATE TABLE `__new_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '',
	`emoji` text,
	`description` text DEFAULT '',
	`model_id` text,
	`settings` text,
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
CREATE TABLE `__new_assistant_knowledge_base` (
	`assistant_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`assistant_id`, `knowledge_base_id`),
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_assistant_knowledge_base`("assistant_id", "knowledge_base_id", "created_at", "updated_at") SELECT "assistant_id", "knowledge_base_id", "created_at", "updated_at" FROM `assistant_knowledge_base`;--> statement-breakpoint
DROP TABLE `assistant_knowledge_base`;--> statement-breakpoint
ALTER TABLE `__new_assistant_knowledge_base` RENAME TO `assistant_knowledge_base`;--> statement-breakpoint
CREATE TABLE `__new_assistant_mcp_server` (
	`assistant_id` text NOT NULL,
	`mcp_server_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`assistant_id`, `mcp_server_id`),
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_assistant_mcp_server`("assistant_id", "mcp_server_id", "created_at", "updated_at") SELECT "assistant_id", "mcp_server_id", "created_at", "updated_at" FROM `assistant_mcp_server`;--> statement-breakpoint
DROP TABLE `assistant_mcp_server`;--> statement-breakpoint
ALTER TABLE `__new_assistant_mcp_server` RENAME TO `assistant_mcp_server`;--> statement-breakpoint
CREATE TABLE `__new_group` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_group`("id", "entity_type", "name", "sort_order", "created_at", "updated_at") SELECT "id", "entity_type", "name", "sort_order", "created_at", "updated_at" FROM `group`;--> statement-breakpoint
DROP TABLE `group`;--> statement-breakpoint
ALTER TABLE `__new_group` RENAME TO `group`;--> statement-breakpoint
CREATE INDEX `group_entity_sort_idx` ON `group` (`entity_type`,`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`group_id` text,
	`emoji` text,
	`dimensions` integer NOT NULL,
	`embedding_model_id` text,
	`rerank_model_id` text,
	`file_processor_id` text,
	`chunk_size` integer NOT NULL DEFAULT 1024,
	`chunk_overlap` integer NOT NULL DEFAULT 200,
	`threshold` real,
	`document_count` integer,
	`search_mode` text DEFAULT 'hybrid',
	`hybrid_alpha` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`embedding_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rerank_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("__new_knowledge_base"."search_mode" IN ('default', 'bm25', 'hybrid') OR "__new_knowledge_base"."search_mode" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_base`("id", "name", "description", "group_id", "emoji", "dimensions", "embedding_model_id", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "threshold", "document_count", "search_mode", "hybrid_alpha", "created_at", "updated_at") SELECT "id", "name", "description", NULL, NULL, "dimensions", "embedding_model_id", "rerank_model_id", "file_processor_id", CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END, CASE WHEN "chunk_overlap" IS NOT NULL AND "chunk_overlap" >= 0 AND "chunk_overlap" < CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END THEN "chunk_overlap" WHEN CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END <= 1 THEN 0 WHEN CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END <= 200 THEN CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END - 1 ELSE 200 END, "threshold", "document_count", CASE WHEN "search_mode" IS NULL OR trim("search_mode") = '' THEN 'hybrid' ELSE "search_mode" END, "hybrid_alpha", "created_at", "updated_at" FROM `knowledge_base`;--> statement-breakpoint
DROP TABLE `knowledge_base`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_base` RENAME TO `knowledge_base`;--> statement-breakpoint
CREATE TABLE `__new_knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("__new_knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory')),
	CONSTRAINT "knowledge_item_status_check" CHECK("__new_knowledge_item"."status" IN ('idle', 'pending', 'file_processing', 'read', 'embed', 'completed', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_item`("id", "base_id", "group_id", "type", "data", "status", "error", "created_at", "updated_at") SELECT "id", "base_id", "group_id", "type", "data", "status", "error", "created_at", "updated_at" FROM `knowledge_item`;--> statement-breakpoint
DROP TABLE `knowledge_item`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_item` RENAME TO `knowledge_item`;--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`description` text,
	`base_url` text,
	`command` text,
	`registry_url` text,
	`args` text,
	`env` text,
	`headers` text,
	`provider` text,
	`provider_url` text,
	`logo_url` text,
	`tags` text,
	`long_running` integer,
	`timeout` integer,
	`dxt_version` text,
	`dxt_path` text,
	`reference` text,
	`search_key` text,
	`config_sample` text,
	`disabled_tools` text,
	`disabled_auto_approve_tools` text,
	`should_config` integer,
	`sort_order` integer DEFAULT 0,
	`is_active` integer DEFAULT false NOT NULL,
	`install_source` text,
	`is_trusted` integer,
	`trusted_at` integer,
	`installed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mcp_server_type_check" CHECK("__new_mcp_server"."type" IS NULL OR "__new_mcp_server"."type" IN ('stdio', 'sse', 'streamableHttp', 'inMemory')),
	CONSTRAINT "mcp_server_install_source_check" CHECK("__new_mcp_server"."install_source" IS NULL OR "__new_mcp_server"."install_source" IN ('builtin', 'manual', 'protocol', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_mcp_server`("id", "name", "type", "description", "base_url", "command", "registry_url", "args", "env", "headers", "provider", "provider_url", "logo_url", "tags", "long_running", "timeout", "dxt_version", "dxt_path", "reference", "search_key", "config_sample", "disabled_tools", "disabled_auto_approve_tools", "should_config", "sort_order", "is_active", "install_source", "is_trusted", "trusted_at", "installed_at", "created_at", "updated_at") SELECT "id", "name", "type", "description", "base_url", "command", "registry_url", "args", "env", "headers", "provider", "provider_url", "logo_url", "tags", "long_running", "timeout", "dxt_version", "dxt_path", "reference", "search_key", "config_sample", "disabled_tools", "disabled_auto_approve_tools", "should_config", "sort_order", "is_active", "install_source", "is_trusted", "trusted_at", "installed_at", "created_at", "updated_at" FROM `mcp_server`;--> statement-breakpoint
DROP TABLE `mcp_server`;--> statement-breakpoint
ALTER TABLE `__new_mcp_server` RENAME TO `mcp_server`;--> statement-breakpoint
CREATE INDEX `mcp_server_name_idx` ON `mcp_server` (`name`);--> statement-breakpoint
CREATE INDEX `mcp_server_is_active_idx` ON `mcp_server` (`is_active`);--> statement-breakpoint
CREATE INDEX `mcp_server_sort_order_idx` ON `mcp_server` (`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_message` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`data` text NOT NULL,
	`searchable_text` text,
	`status` text NOT NULL,
	`siblings_group_id` integer DEFAULT 0,
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
CREATE INDEX `message_trace_id_idx` ON `message` (`trace_id`);--> statement-breakpoint
CREATE TABLE `__new_miniapp` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`type` text DEFAULT 'custom' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`sort_order` integer DEFAULT 0,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "miniapp_status_check" CHECK("__new_miniapp"."status" IN ('enabled', 'disabled', 'pinned')),
	CONSTRAINT "miniapp_type_check" CHECK("__new_miniapp"."type" IN ('default', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_miniapp`("app_id", "name", "url", "logo", "type", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "name", "url", "logo", "type", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `miniapp`;--> statement-breakpoint
DROP TABLE `miniapp`;--> statement-breakpoint
ALTER TABLE `__new_miniapp` RENAME TO `miniapp`;--> statement-breakpoint
CREATE INDEX `miniapp_status_sort_idx` ON `miniapp` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `miniapp_type_idx` ON `miniapp` (`type`);--> statement-breakpoint
CREATE INDEX `miniapp_status_type_idx` ON `miniapp` (`status`,`type`);--> statement-breakpoint
CREATE TABLE `__new_preference` (
	`scope` text DEFAULT 'default' NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_preference`("scope", "key", "value", "created_at", "updated_at") SELECT "scope", "key", "value", "created_at", "updated_at" FROM `preference`;--> statement-breakpoint
DROP TABLE `preference`;--> statement-breakpoint
ALTER TABLE `__new_preference` RENAME TO `preference`;--> statement-breakpoint
CREATE TABLE `__new_entity_tag` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`, `tag_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_entity_tag`("entity_type", "entity_id", "tag_id", "created_at", "updated_at") SELECT "entity_type", "entity_id", "tag_id", "created_at", "updated_at" FROM `entity_tag`;--> statement-breakpoint
DROP TABLE `entity_tag`;--> statement-breakpoint
ALTER TABLE `__new_entity_tag` RENAME TO `entity_tag`;--> statement-breakpoint
CREATE INDEX `entity_tag_tag_id_idx` ON `entity_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `__new_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tag`("id", "name", "color", "created_at", "updated_at") SELECT "id", "name", "color", "created_at", "updated_at" FROM `tag`;--> statement-breakpoint
DROP TABLE `tag`;--> statement-breakpoint
ALTER TABLE `__new_tag` RENAME TO `tag`;--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `__new_topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`is_name_manually_edited` integer DEFAULT false,
	`assistant_id` text,
	`active_node_id` text,
	`group_id` text,
	`sort_order` integer DEFAULT 0,
	`is_pinned` integer DEFAULT false,
	`pinned_order` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_topic`("id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "group_id", "sort_order", "is_pinned", "pinned_order", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "group_id", "sort_order", "is_pinned", "pinned_order", "created_at", "updated_at", "deleted_at" FROM `topic`;--> statement-breakpoint
DROP TABLE `topic`;--> statement-breakpoint
ALTER TABLE `__new_topic` RENAME TO `topic`;--> statement-breakpoint
CREATE INDEX `topic_group_updated_idx` ON `topic` (`group_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_group_sort_idx` ON `topic` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_is_pinned_idx` ON `topic` (`is_pinned`,`pinned_order`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);--> statement-breakpoint
CREATE TABLE `__new_translate_history` (
	`id` text PRIMARY KEY NOT NULL,
	`source_text` text NOT NULL,
	`target_text` text NOT NULL,
	`source_language` text,
	`target_language` text,
	`star` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_language`) REFERENCES `translate_language`(`lang_code`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_language`) REFERENCES `translate_language`(`lang_code`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_translate_history`("id", "source_text", "target_text", "source_language", "target_language", "star", "created_at", "updated_at") SELECT "id", "source_text", "target_text", "source_language", "target_language", "star", "created_at", "updated_at" FROM `translate_history`;--> statement-breakpoint
DROP TABLE `translate_history`;--> statement-breakpoint
ALTER TABLE `__new_translate_history` RENAME TO `translate_history`;--> statement-breakpoint
CREATE INDEX `translate_history_created_at_idx` ON `translate_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `translate_history_star_created_at_idx` ON `translate_history` (`star`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_translate_language` (
	`lang_code` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_translate_language`("lang_code", "value", "emoji", "created_at", "updated_at") SELECT "lang_code", "value", "emoji", "created_at", "updated_at" FROM `translate_language`;--> statement-breakpoint
DROP TABLE `translate_language`;--> statement-breakpoint
ALTER TABLE `__new_translate_language` RENAME TO `translate_language`;--> statement-breakpoint
CREATE TABLE `__new_user_model` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`preset_model_id` text,
	`name` text,
	`description` text,
	`group` text,
	`capabilities` text,
	`input_modalities` text,
	`output_modalities` text,
	`endpoint_types` text,
	`custom_endpoint_url` text,
	`context_window` integer,
	`max_output_tokens` integer,
	`supports_streaming` integer,
	`reasoning` text,
	`parameters` text,
	`pricing` text,
	`is_enabled` integer DEFAULT true,
	`is_hidden` integer DEFAULT false,
	`is_deprecated` integer DEFAULT false,
	`sort_order` integer DEFAULT 0,
	`notes` text,
	`user_overrides` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `user_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_model`("id", "provider_id", "model_id", "preset_model_id", "name", "description", "group", "capabilities", "input_modalities", "output_modalities", "endpoint_types", "custom_endpoint_url", "context_window", "max_output_tokens", "supports_streaming", "reasoning", "parameters", "pricing", "is_enabled", "is_hidden", "is_deprecated", "sort_order", "notes", "user_overrides", "created_at", "updated_at") SELECT "id", "provider_id", "model_id", "preset_model_id", "name", "description", "group", "capabilities", "input_modalities", "output_modalities", "endpoint_types", "custom_endpoint_url", "context_window", "max_output_tokens", "supports_streaming", "reasoning", "parameters", "pricing", "is_enabled", "is_hidden", "is_deprecated", "sort_order", "notes", "user_overrides", "created_at", "updated_at" FROM `user_model`;--> statement-breakpoint
DROP TABLE `user_model`;--> statement-breakpoint
ALTER TABLE `__new_user_model` RENAME TO `user_model`;--> statement-breakpoint
CREATE INDEX `user_model_preset_idx` ON `user_model` (`preset_model_id`);--> statement-breakpoint
CREATE INDEX `user_model_provider_enabled_idx` ON `user_model` (`provider_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_model_provider_sort_idx` ON `user_model` (`provider_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_model_provider_model_unique` ON `user_model` (`provider_id`,`model_id`);--> statement-breakpoint
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
	`is_enabled` integer DEFAULT true,
	`sort_order` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_provider`("provider_id", "preset_provider_id", "name", "endpoint_configs", "default_chat_endpoint", "api_keys", "auth_config", "api_features", "provider_settings", "is_enabled", "sort_order", "created_at", "updated_at") SELECT "provider_id", "preset_provider_id", "name", "endpoint_configs", "default_chat_endpoint", "api_keys", "auth_config", "api_features", "provider_settings", "is_enabled", "sort_order", "created_at", "updated_at" FROM `user_provider`;--> statement-breakpoint
DROP TABLE `user_provider`;--> statement-breakpoint
ALTER TABLE `__new_user_provider` RENAME TO `user_provider`;--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_sort_idx` ON `user_provider` (`is_enabled`,`sort_order`);

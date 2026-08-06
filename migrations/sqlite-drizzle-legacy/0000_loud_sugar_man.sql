CREATE TABLE `agent` (
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
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
CREATE INDEX `agent_sort_order_idx` ON `agent` (`sort_order`);--> statement-breakpoint
CREATE TABLE `agent_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`session_id` text,
	`config` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`active_chat_ids` text DEFAULT '[]' NOT NULL,
	`permission_mode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_channel_type_check" CHECK("agent_channel"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')),
	CONSTRAINT "agent_channel_permission_mode_check" CHECK("agent_channel"."permission_mode" IS NULL OR "agent_channel"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
CREATE INDEX `agent_channel_agent_id_idx` ON `agent_channel` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_type_idx` ON `agent_channel` (`type`);--> statement-breakpoint
CREATE INDEX `agent_channel_session_id_idx` ON `agent_channel` (`session_id`);--> statement-breakpoint
CREATE TABLE `agent_channel_task` (
	`channel_id` text NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`channel_id`, `task_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `agent_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `agent_task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_channel_task_channel_id_idx` ON `agent_channel_task` (`channel_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_task_task_id_idx` ON `agent_channel_task` (`task_id`);--> statement-breakpoint
CREATE TABLE `agent_global_skill` (
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
CREATE UNIQUE INDEX `agent_global_skill_folder_name_unique` ON `agent_global_skill` (`folder_name`);--> statement-breakpoint
CREATE INDEX `agent_global_skill_source_idx` ON `agent_global_skill` (`source`);--> statement-breakpoint
CREATE INDEX `agent_global_skill_is_enabled_idx` ON `agent_global_skill` (`is_enabled`);--> statement-breakpoint
CREATE TABLE `agent_session` (
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
CREATE INDEX `agent_session_agent_id_idx` ON `agent_session` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_session_model_idx` ON `agent_session` (`model`);--> statement-breakpoint
CREATE INDEX `agent_session_sort_order_idx` ON `agent_session` (`sort_order`);--> statement-breakpoint
CREATE TABLE `agent_session_message` (
	`id` text PRIMARY KEY NOT NULL,
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
CREATE INDEX `agent_session_message_session_id_idx` ON `agent_session_message` (`session_id`);--> statement-breakpoint
CREATE TABLE `agent_skill` (
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
CREATE INDEX `agent_skill_agent_id_idx` ON `agent_skill` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_skill_skill_id_idx` ON `agent_skill` (`skill_id`);--> statement-breakpoint
CREATE TABLE `agent_task_run_log` (
	`id` text PRIMARY KEY NOT NULL,
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
	CONSTRAINT "agent_task_run_log_status_check" CHECK("agent_task_run_log"."status" IN ('running', 'success', 'error'))
);
--> statement-breakpoint
CREATE INDEX `agent_task_run_log_task_id_idx` ON `agent_task_run_log` (`task_id`);--> statement-breakpoint
CREATE TABLE `agent_task` (
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
	CONSTRAINT "agent_task_schedule_type_check" CHECK("agent_task"."schedule_type" IN ('cron', 'interval', 'once')),
	CONSTRAINT "agent_task_status_check" CHECK("agent_task"."status" IN ('active', 'paused', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `agent_task_agent_id_idx` ON `agent_task` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_task_next_run_idx` ON `agent_task` (`next_run`);--> statement-breakpoint
CREATE INDEX `agent_task_status_idx` ON `agent_task` (`status`);--> statement-breakpoint
CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assistant` (
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
CREATE INDEX `assistant_created_at_idx` ON `assistant` (`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_knowledge_base` (
	`assistant_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`assistant_id`, `knowledge_base_id`),
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assistant_mcp_server` (
	`assistant_id` text NOT NULL,
	`mcp_server_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`assistant_id`, `mcp_server_id`),
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`size` integer,
	`external_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "fe_origin_check" CHECK("file_entry"."origin" IN ('internal', 'external')),
	CONSTRAINT "fe_origin_consistency" CHECK(("file_entry"."origin" = 'internal' AND "file_entry"."external_path" IS NULL) OR ("file_entry"."origin" = 'external' AND "file_entry"."external_path" IS NOT NULL)),
	CONSTRAINT "fe_external_no_delete" CHECK("file_entry"."origin" != 'external' OR "file_entry"."deleted_at" IS NULL),
	CONSTRAINT "fe_size_internal_only" CHECK(("file_entry"."origin" = 'internal' AND "file_entry"."size" IS NOT NULL AND "file_entry"."size" >= 0) OR ("file_entry"."origin" = 'external' AND "file_entry"."size" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `fe_deleted_at_idx` ON `file_entry` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `fe_created_at_idx` ON `file_entry` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `fe_external_path_lower_unique_idx` ON `file_entry` (lower("external_path"));--> statement-breakpoint
CREATE INDEX `fe_external_path_idx` ON `file_entry` (`external_path`);--> statement-breakpoint
CREATE TABLE `file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_ref_entry_id_idx` ON `file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `file_ref_source_idx` ON `file_ref` (`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_ref_unique_idx` ON `file_ref` (`file_entry_id`,`source_type`,`source_id`,`role`);--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `group_entity_type_order_key_idx` ON `group` (`entity_type`,`order_key`);--> statement-breakpoint
CREATE TABLE `job_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`trigger` text NOT NULL,
	`job_input_template` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run` integer,
	`last_run` integer,
	`catch_up_policy` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_schedule_type_name_uq` ON `job_schedule` (`type`,`name`);--> statement-breakpoint
CREATE INDEX `job_schedule_enabled_next_run_idx` ON `job_schedule` (`enabled`,`next_run`);--> statement-breakpoint
CREATE INDEX `job_schedule_type_idx` ON `job_schedule` (`type`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`queue` text NOT NULL,
	`idempotency_key` text,
	`schedule_id` text,
	`scheduled_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`parent_id` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`timeout_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `job_schedule`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "job_status_check" CHECK("job"."status" IN ('pending','delayed','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `job_queue_status_scheduled_at_idx` ON `job` (`queue`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_status_idx` ON `job` (`status`);--> statement-breakpoint
CREATE INDEX `job_schedule_id_finished_at_idx` ON `job` (`schedule_id`,`finished_at`);--> statement-breakpoint
CREATE INDEX `job_parent_id_idx` ON `job` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_idempotency_key_partial_uq` ON `job` (`idempotency_key`) WHERE "job"."idempotency_key" IS NOT NULL AND "job"."status" NOT IN ('completed','failed','cancelled');--> statement-breakpoint
CREATE TABLE `knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_id` text,
	`emoji` text NOT NULL,
	`dimensions` integer,
	`embedding_model_id` text,
	`status` text NOT NULL,
	`error` text,
	`rerank_model_id` text,
	`file_processor_id` text,
	`chunk_size` integer NOT NULL,
	`chunk_overlap` integer NOT NULL,
	`threshold` real,
	`document_count` integer,
	`search_mode` text NOT NULL,
	`hybrid_alpha` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`embedding_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rerank_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("knowledge_base"."search_mode" IN ('default', 'bm25', 'hybrid')),
	CONSTRAINT "knowledge_base_status_check" CHECK("knowledge_base"."status" IN ('completed', 'failed')),
	CONSTRAINT "knowledge_base_status_error_check" CHECK(
        (
          "knowledge_base"."status" = 'completed'
          AND "knowledge_base"."embedding_model_id" IS NOT NULL
          AND "knowledge_base"."dimensions" IS NOT NULL
          AND "knowledge_base"."dimensions" > 0
          AND "knowledge_base"."error" IS NULL
        )
        OR (
          "knowledge_base"."status" = 'failed'
          AND "knowledge_base"."error" IS NOT NULL
          AND length(trim("knowledge_base"."error")) > 0
        )
      )
);
--> statement-breakpoint
CREATE TABLE `knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory')),
	CONSTRAINT "knowledge_item_status_check" CHECK("knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting')),
	CONSTRAINT "knowledge_item_type_status_check" CHECK(
        ("knowledge_item"."type" IN ('file', 'url', 'note') AND "knowledge_item"."status" IN ('idle', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting'))
        OR ("knowledge_item"."type" IN ('directory', 'sitemap') AND "knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'completed', 'failed', 'deleting'))
      ),
	CONSTRAINT "knowledge_item_status_error_check" CHECK(
        (
          "knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'deleting')
          AND "knowledge_item"."error" IS NULL
        )
        OR (
          "knowledge_item"."status" = 'failed'
          AND "knowledge_item"."error" IS NOT NULL
          AND length(trim("knowledge_item"."error")) > 0
        )
      )
);
--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);--> statement-breakpoint
CREATE TABLE `mcp_server` (
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
	CONSTRAINT "mcp_server_type_check" CHECK("mcp_server"."type" IS NULL OR "mcp_server"."type" IN ('stdio', 'sse', 'streamableHttp', 'inMemory')),
	CONSTRAINT "mcp_server_install_source_check" CHECK("mcp_server"."install_source" IS NULL OR "mcp_server"."install_source" IN ('builtin', 'manual', 'protocol', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `mcp_server_name_idx` ON `mcp_server` (`name`);--> statement-breakpoint
CREATE INDEX `mcp_server_is_active_idx` ON `mcp_server` (`is_active`);--> statement-breakpoint
CREATE INDEX `mcp_server_sort_order_idx` ON `mcp_server` (`sort_order`);--> statement-breakpoint
CREATE TABLE `message` (
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
	CONSTRAINT "message_role_check" CHECK("message"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "message_status_check" CHECK("message"."status" IN ('pending', 'success', 'error', 'paused'))
);
--> statement-breakpoint
CREATE INDEX `message_parent_id_idx` ON `message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `message_topic_created_idx` ON `message` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_trace_id_idx` ON `message` (`trace_id`);--> statement-breakpoint
CREATE TABLE `mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`preset_mini_app_id` text,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`status` text DEFAULT 'enabled' NOT NULL,
	`order_key` text NOT NULL,
	`bordered` integer DEFAULT true NOT NULL,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("mini_app"."status" IN ('enabled', 'disabled', 'pinned'))
);
--> statement-breakpoint
CREATE INDEX `mini_app_status_order_key_idx` ON `mini_app` (`status`,`order_key`);--> statement-breakpoint
CREATE INDEX `mini_app_preset_mini_app_id_idx` ON `mini_app` (`preset_mini_app_id`);--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`path` text NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_expanded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "note_has_state_check" CHECK("note"."is_starred" = 1 OR "note"."is_expanded" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_root_path_path_unique_idx` ON `note` (`root_path`,`path`);--> statement-breakpoint
CREATE TABLE `pin` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pin_entity_type_entity_id_unique_idx` ON `pin` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `pin_entity_type_order_key_idx` ON `pin` (`entity_type`,`order_key`);--> statement-breakpoint
CREATE TABLE `preference` (
	`scope` text DEFAULT 'default' NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE TABLE `prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_order_key_idx` ON `prompt` (`order_key`);--> statement-breakpoint
CREATE TABLE `entity_tag` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`, `tag_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_tag_tag_id_idx` ON `entity_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `topic` (
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
CREATE INDEX `topic_group_updated_idx` ON `topic` (`group_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_group_id_order_key_idx` ON `topic` (`group_id`,`order_key`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);--> statement-breakpoint
CREATE TABLE `translate_history` (
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
CREATE INDEX `translate_history_created_at_idx` ON `translate_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `translate_history_star_created_at_idx` ON `translate_history` (`star`,`created_at`);--> statement-breakpoint
CREATE TABLE `translate_language` (
	`lang_code` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_model` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`preset_model_id` text,
	`name` text NOT NULL,
	`description` text,
	`group` text,
	`capabilities` text NOT NULL,
	`input_modalities` text,
	`output_modalities` text,
	`endpoint_types` text,
	`custom_endpoint_url` text,
	`context_window` integer,
	`max_input_tokens` integer,
	`max_output_tokens` integer,
	`supports_streaming` integer DEFAULT true NOT NULL,
	`reasoning` text,
	`parameters` text,
	`pricing` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`is_deprecated` integer DEFAULT false NOT NULL,
	`order_key` text NOT NULL,
	`notes` text,
	`user_overrides` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `user_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_model_preset_idx` ON `user_model` (`preset_model_id`);--> statement-breakpoint
CREATE INDEX `user_model_provider_enabled_idx` ON `user_model` (`provider_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_model_provider_id_order_key_idx` ON `user_model` (`provider_id`,`order_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_model_provider_model_unique` ON `user_model` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `user_provider` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`preset_provider_id` text,
	`name` text NOT NULL,
	`endpoint_configs` text,
	`default_chat_endpoint` text,
	`api_keys` text DEFAULT '[]',
	`auth_config` text,
	`api_features` text,
	`provider_settings` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_idx` ON `user_provider` (`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_provider_order_key_idx` ON `user_provider` (`order_key`);
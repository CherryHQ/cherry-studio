CREATE TABLE `agents_agents` (
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
	`deleted_at` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `agents_agents_name_idx` ON `agents_agents` (`name`);--> statement-breakpoint
CREATE INDEX `agents_agents_type_idx` ON `agents_agents` (`type`);--> statement-breakpoint
CREATE INDEX `agents_agents_sort_order_idx` ON `agents_agents` (`sort_order`);--> statement-breakpoint
CREATE TABLE `agents_channel_task_subscriptions` (
	`channel_id` text NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`channel_id`, `task_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `agents_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `agents_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_channel_task_subscriptions_channel_id_idx` ON `agents_channel_task_subscriptions` (`channel_id`);--> statement-breakpoint
CREATE INDEX `agents_channel_task_subscriptions_task_id_idx` ON `agents_channel_task_subscriptions` (`task_id`);--> statement-breakpoint
CREATE TABLE `agents_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`session_id` text,
	`config` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`active_chat_ids` text DEFAULT '[]',
	`permission_mode` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents_agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `agents_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agents_channels_type_check" CHECK("agents_channels"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')),
	CONSTRAINT "agents_channels_permission_mode_check" CHECK("agents_channels"."permission_mode" IS NULL OR "agents_channels"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
CREATE INDEX `agents_channels_agent_id_idx` ON `agents_channels` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agents_channels_type_idx` ON `agents_channels` (`type`);--> statement-breakpoint
CREATE INDEX `agents_channels_session_id_idx` ON `agents_channels` (`session_id`);--> statement-breakpoint
CREATE TABLE `agents_session_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`agent_session_id` text DEFAULT '',
	`metadata` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `agents_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_session_messages_session_id_idx` ON `agents_session_messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `agents_sessions` (
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
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_sessions_agent_id_idx` ON `agents_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agents_sessions_model_idx` ON `agents_sessions` (`model`);--> statement-breakpoint
CREATE INDEX `agents_sessions_sort_order_idx` ON `agents_sessions` (`sort_order`);--> statement-breakpoint
CREATE TABLE `agents_skills` (
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
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_skills_folder_name_unique` ON `agents_skills` (`folder_name`);--> statement-breakpoint
CREATE INDEX `agents_skills_source_idx` ON `agents_skills` (`source`);--> statement-breakpoint
CREATE INDEX `agents_skills_is_enabled_idx` ON `agents_skills` (`is_enabled`);--> statement-breakpoint
CREATE TABLE `agents_task_run_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text,
	`run_at` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `agents_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_task_run_logs_task_id_idx` ON `agents_task_run_logs` (`task_id`);--> statement-breakpoint
CREATE TABLE `agents_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_value` text NOT NULL,
	`timeout_minutes` integer DEFAULT 2 NOT NULL,
	`next_run` text,
	`last_run` text,
	`last_result` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_tasks_agent_id_idx` ON `agents_tasks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agents_tasks_next_run_idx` ON `agents_tasks` (`next_run`);--> statement-breakpoint
CREATE INDEX `agents_tasks_status_idx` ON `agents_tasks` (`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("__new_knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory')),
	CONSTRAINT "knowledge_item_status_check" CHECK("__new_knowledge_item"."status" IN ('idle', 'pending', 'file_processing', 'read', 'embed', 'completed', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_item`("id", "base_id", "group_id", "type", "data", "status", "error", "created_at", "updated_at") SELECT "id", "base_id", "group_id", "type", "data", "status", "error", "created_at", "updated_at" FROM `knowledge_item`;--> statement-breakpoint
DROP TABLE `knowledge_item`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_item` RENAME TO `knowledge_item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);
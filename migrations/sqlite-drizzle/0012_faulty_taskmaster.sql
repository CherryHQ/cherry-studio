CREATE TABLE `agent` (
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
	`created_at` integer,
	`updated_at` integer,
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
	`active_chat_ids` text DEFAULT '[]',
	`permission_mode` text,
	`created_at` integer,
	`updated_at` integer,
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
	`tags` text,
	`content_hash` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer,
	`updated_at` integer
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
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_session_agent_id_idx` ON `agent_session` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_session_model_idx` ON `agent_session` (`model`);--> statement-breakpoint
CREATE INDEX `agent_session_sort_order_idx` ON `agent_session` (`sort_order`);--> statement-breakpoint
CREATE TABLE `agent_session_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`agent_session_id` text DEFAULT '',
	`metadata` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_session_message_session_id_idx` ON `agent_session_message` (`session_id`);--> statement-breakpoint
CREATE TABLE `agent_skill` (
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`agent_id`, `skill_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `agent_global_skill`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_skill_agent_id_idx` ON `agent_skill` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_skill_skill_id_idx` ON `agent_skill` (`skill_id`);--> statement-breakpoint
CREATE TABLE `agent_task_run_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text,
	`run_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `agent_task`(`id`) ON UPDATE no action ON DELETE cascade
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
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_task_agent_id_idx` ON `agent_task` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_task_next_run_idx` ON `agent_task` (`next_run`);--> statement-breakpoint
CREATE INDEX `agent_task_status_idx` ON `agent_task` (`status`);
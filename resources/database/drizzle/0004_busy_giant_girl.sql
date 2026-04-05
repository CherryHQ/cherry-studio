CREATE TABLE `channel_task_subscriptions` (
	`channel_id` text NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`channel_id`, `task_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `scheduled_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cts_channel_id_idx` ON `channel_task_subscriptions` (`channel_id`);--> statement-breakpoint
CREATE INDEX `cts_task_id_idx` ON `channel_task_subscriptions` (`task_id`);--> statement-breakpoint
CREATE TABLE `channels` (
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
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "channels_type_check" CHECK("channels"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')),
	CONSTRAINT "channels_permission_mode_check" CHECK("channels"."permission_mode" IS NULL OR "channels"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
CREATE INDEX `channels_agent_id_idx` ON `channels` (`agent_id`);--> statement-breakpoint
CREATE INDEX `channels_type_idx` ON `channels` (`type`);--> statement-breakpoint
CREATE INDEX `channels_session_id_idx` ON `channels` (`session_id`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_run_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text,
	`run_at` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text
);

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
	`permission_mode` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "channels_type_check" CHECK("channels"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord')),
	CONSTRAINT "channels_permission_mode_check" CHECK("channels"."permission_mode" IS NULL OR "channels"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
CREATE INDEX `channels_agent_id_idx` ON `channels` (`agent_id`);--> statement-breakpoint
CREATE INDEX `channels_type_idx` ON `channels` (`type`);--> statement-breakpoint
CREATE INDEX `channels_session_id_idx` ON `channels` (`session_id`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_channel` (
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
	CONSTRAINT "agent_channel_type_check" CHECK("__new_agent_channel"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')),
	CONSTRAINT "agent_channel_permission_mode_check" CHECK("__new_agent_channel"."permission_mode" IS NULL OR "__new_agent_channel"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_channel`("id", "type", "name", "agent_id", "session_id", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at") SELECT "id", "type", "name", "agent_id", "session_id", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at" FROM `agent_channel`;--> statement-breakpoint
DROP TABLE `agent_channel`;--> statement-breakpoint
ALTER TABLE `__new_agent_channel` RENAME TO `agent_channel`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_channel_agent_id_idx` ON `agent_channel` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_type_idx` ON `agent_channel` (`type`);--> statement-breakpoint
CREATE INDEX `agent_channel_session_id_idx` ON `agent_channel` (`session_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_session_message` (
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
INSERT INTO `__new_agent_session_message`("id", "session_id", "role", "content", "agent_session_id", "metadata", "created_at", "updated_at") SELECT "id", "session_id", "role", "content", "agent_session_id", "metadata", "created_at", "updated_at" FROM `agent_session_message`;--> statement-breakpoint
DROP TABLE `agent_session_message`;--> statement-breakpoint
ALTER TABLE `__new_agent_session_message` RENAME TO `agent_session_message`;--> statement-breakpoint
CREATE INDEX `agent_session_message_session_id_idx` ON `agent_session_message` (`session_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_task_run_log` (
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
	CONSTRAINT "agent_task_run_log_status_check" CHECK("__new_agent_task_run_log"."status" IN ('running', 'success', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_task_run_log`("id", "task_id", "session_id", "run_at", "duration_ms", "status", "result", "error", "created_at", "updated_at") SELECT "id", "task_id", "session_id", "run_at", "duration_ms", "status", "result", "error", "created_at", "updated_at" FROM `agent_task_run_log`;--> statement-breakpoint
DROP TABLE `agent_task_run_log`;--> statement-breakpoint
ALTER TABLE `__new_agent_task_run_log` RENAME TO `agent_task_run_log`;--> statement-breakpoint
CREATE INDEX `agent_task_run_log_task_id_idx` ON `agent_task_run_log` (`task_id`);
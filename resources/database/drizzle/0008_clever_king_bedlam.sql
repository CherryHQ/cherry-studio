PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_channels` (
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
	CONSTRAINT "channels_type_check" CHECK("__new_channels"."type" IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')),
	CONSTRAINT "channels_permission_mode_check" CHECK("__new_channels"."permission_mode" IS NULL OR "__new_channels"."permission_mode" IN ('default', 'acceptEdits', 'bypassPermissions', 'plan'))
);
--> statement-breakpoint
INSERT INTO `__new_channels`("id", "type", "name", "agent_id", "session_id", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at") SELECT "id", "type", "name", "agent_id", "session_id", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at" FROM `channels`;--> statement-breakpoint
DROP TABLE `channels`;--> statement-breakpoint
ALTER TABLE `__new_channels` RENAME TO `channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `channels_agent_id_idx` ON `channels` (`agent_id`);--> statement-breakpoint
CREATE INDEX `channels_type_idx` ON `channels` (`type`);--> statement-breakpoint
CREATE INDEX `channels_session_id_idx` ON `channels` (`session_id`);
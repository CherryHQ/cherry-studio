PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`session_id` text,
	`workspace` text NOT NULL,
	`config` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`active_chat_ids` text DEFAULT '[]' NOT NULL,
	`permission_mode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_channel`("id", "type", "name", "agent_id", "session_id", "workspace", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at") SELECT "id", "type", "name", "agent_id", "session_id", "workspace", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at" FROM `agent_channel`;--> statement-breakpoint
DROP TABLE `agent_channel`;--> statement-breakpoint
ALTER TABLE `__new_agent_channel` RENAME TO `agent_channel`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_channel_agent_id_idx` ON `agent_channel` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_type_idx` ON `agent_channel` (`type`);--> statement-breakpoint
CREATE INDEX `agent_channel_session_id_idx` ON `agent_channel` (`session_id`);
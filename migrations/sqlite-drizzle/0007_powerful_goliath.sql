PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_session_message` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`data` text NOT NULL,
	`searchable_text` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`model_id` text,
	`message_snapshot` text,
	`stats` text,
	`runtime_resume_token` text,
	`delivery` text,
	`delivery_status` text,
	`delivery_in_reply_to` text,
	`delivery_sender_session_id` text,
	`fts_rowid` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_session_message_role_check" CHECK("__new_agent_session_message"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "agent_session_message_status_check" CHECK("__new_agent_session_message"."status" IN ('pending', 'success', 'error', 'paused')),
	CONSTRAINT "agent_session_message_delivery_status_check" CHECK("__new_agent_session_message"."delivery_status" IS NULL OR "__new_agent_session_message"."delivery_status" IN ('accepted', 'queued', 'delivering', 'consumed', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_session_message`("id", "session_id", "role", "data", "searchable_text", "status", "model_id", "message_snapshot", "stats", "runtime_resume_token", "delivery", "delivery_status", "delivery_in_reply_to", "delivery_sender_session_id", "fts_rowid", "created_at", "updated_at") SELECT "id", "session_id", "role", "data", "searchable_text", "status", "model_id", "message_snapshot", "stats", "runtime_resume_token", NULL, NULL, NULL, NULL, "fts_rowid", "created_at", "updated_at" FROM `agent_session_message`;--> statement-breakpoint
DROP TABLE `agent_session_message`;--> statement-breakpoint
ALTER TABLE `__new_agent_session_message` RENAME TO `agent_session_message`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_session_message_session_created_id_idx` ON `agent_session_message` (`session_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_message_status_idx` ON `agent_session_message` (`status`);--> statement-breakpoint
CREATE INDEX `agent_session_message_delivery_status_idx` ON `agent_session_message` (`delivery_status`);--> statement-breakpoint
CREATE INDEX `agent_session_message_delivery_sender_idx` ON `agent_session_message` (`delivery_sender_session_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_delivery_reply_uniq` ON `agent_session_message` (`delivery_in_reply_to`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_fts_rowid_uniq` ON `agent_session_message` (`fts_rowid`);

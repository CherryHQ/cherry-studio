PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_channel_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`conversation_id` text,
	`conversation_kind` text,
	`is_active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `agent_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_channel_session_conversation_id_nonempty_check" CHECK("__new_agent_channel_session"."conversation_id" IS NULL OR length(trim("__new_agent_channel_session"."conversation_id")) > 0),
	CONSTRAINT "agent_channel_session_conversation_kind_check" CHECK("__new_agent_channel_session"."conversation_kind" IS NULL OR "__new_agent_channel_session"."conversation_kind" IN ('direct', 'group', 'channel', 'thread')),
	CONSTRAINT "agent_channel_session_active_conversation_check" CHECK("__new_agent_channel_session"."is_active" = 0 OR ("__new_agent_channel_session"."conversation_id" IS NOT NULL AND "__new_agent_channel_session"."conversation_kind" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_agent_channel_session`("session_id", "channel_id", "conversation_id", "conversation_kind", "is_active") SELECT "session_id", "channel_id", "conversation_id", "conversation_kind", "is_active" FROM `agent_channel_session`;--> statement-breakpoint
DROP TABLE `agent_channel_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_channel_session` RENAME TO `agent_channel_session`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_channel_session_channel_id_idx` ON `agent_channel_session` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_channel_session_active_uniq` ON `agent_channel_session` (`channel_id`,`conversation_id`) WHERE "agent_channel_session"."is_active" = 1 AND "agent_channel_session"."conversation_id" IS NOT NULL;
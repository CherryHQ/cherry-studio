CREATE TABLE `agent_channel_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`conversation_id` text,
	`conversation_kind` text,
	`is_active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `agent_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_channel_session_conversation_id_nonempty_check" CHECK("agent_channel_session"."conversation_id" IS NULL OR length(trim("agent_channel_session"."conversation_id")) > 0),
	CONSTRAINT "agent_channel_session_conversation_kind_check" CHECK("agent_channel_session"."conversation_kind" IS NULL OR "agent_channel_session"."conversation_kind" IN ('direct', 'group', 'channel', 'thread')),
	CONSTRAINT "agent_channel_session_active_conversation_check" CHECK("agent_channel_session"."is_active" = 0 OR ("agent_channel_session"."conversation_id" IS NOT NULL AND "agent_channel_session"."conversation_kind" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `agent_channel_session_channel_id_idx` ON `agent_channel_session` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_channel_session_active_uniq` ON `agent_channel_session` (`channel_id`,`conversation_id`) WHERE "agent_channel_session"."is_active" = 1 AND "agent_channel_session"."conversation_id" IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `agent_channel_session` (`session_id`, `channel_id`, `conversation_id`, `conversation_kind`, `is_active`)
SELECT `session_id`, `id`, NULL, NULL, false
FROM (
	SELECT
		`session_id`,
		`id`,
		row_number() OVER (PARTITION BY `session_id` ORDER BY `updated_at` DESC, `id` DESC) AS `relation_rank`
	FROM `agent_channel`
	WHERE `session_id` IS NOT NULL
)
WHERE `relation_rank` = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`workspace` text NOT NULL,
	`config` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`active_chat_ids` text DEFAULT '[]' NOT NULL,
	`permission_mode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_channel`("id", "type", "name", "agent_id", "workspace", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at") SELECT "id", "type", "name", "agent_id", "workspace", "config", "is_active", "active_chat_ids", "permission_mode", "created_at", "updated_at" FROM `agent_channel`;--> statement-breakpoint
DROP TABLE `agent_channel`;--> statement-breakpoint
ALTER TABLE `__new_agent_channel` RENAME TO `agent_channel`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_channel_agent_id_idx` ON `agent_channel` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_type_idx` ON `agent_channel` (`type`);

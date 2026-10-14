CREATE TABLE `agent_channel_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`conversation_id` text,
	`is_active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `agent_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_channel_session_conversation_id_nonempty_check" CHECK("agent_channel_session"."conversation_id" IS NULL OR length(trim("agent_channel_session"."conversation_id")) > 0),
	CONSTRAINT "agent_channel_session_active_conversation_check" CHECK("agent_channel_session"."is_active" = 0 OR "agent_channel_session"."conversation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `agent_channel_session_channel_id_idx` ON `agent_channel_session` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_channel_session_active_uniq` ON `agent_channel_session` (`channel_id`,`conversation_id`) WHERE "agent_channel_session"."is_active" = 1 AND "agent_channel_session"."conversation_id" IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `agent_channel_session` (`session_id`, `channel_id`, `conversation_id`, `is_active`)
SELECT `session_id`, `id`, NULL, false
FROM (
  SELECT
    `session_id`,
    `id`,
    row_number() OVER (PARTITION BY `session_id` ORDER BY `updated_at` DESC, `id` DESC) AS `relation_rank`
  FROM `agent_channel`
  WHERE `session_id` IS NOT NULL
)
WHERE `relation_rank` = 1;

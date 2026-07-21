DROP INDEX `agent_session_updated_at_idx`;--> statement-breakpoint
-- SQLite cannot add a NOT NULL column without a DB default to a populated table.
-- Add it in place, then backfill every existing row below; Drizzle supplies future values.
ALTER TABLE `agent_session` ADD `last_activity_at` integer;--> statement-breakpoint
DROP INDEX `topic_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `last_activity_at` integer;--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `terminal_at` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `terminal_at` integer;--> statement-breakpoint
UPDATE `message`
SET `terminal_at` = `updated_at`
WHERE `role` = 'assistant'
  AND `status` IN ('success', 'error', 'paused');--> statement-breakpoint
UPDATE `agent_session_message`
SET `terminal_at` = `updated_at`
WHERE `role` = 'assistant'
  AND `status` IN ('success', 'error', 'paused');--> statement-breakpoint
UPDATE `topic`
SET `last_activity_at` = max(
  `created_at`,
  coalesce((
    SELECT max(CASE
      WHEN `message`.`role` = 'user' THEN `message`.`created_at`
      WHEN `message`.`role` = 'assistant'
        THEN max(`message`.`created_at`, coalesce(`message`.`terminal_at`, `message`.`created_at`))
      ELSE NULL
    END)
    FROM `message`
    WHERE `message`.`topic_id` = `topic`.`id`
      AND `message`.`deleted_at` IS NULL
  ), `created_at`)
);--> statement-breakpoint
UPDATE `agent_session`
SET `last_activity_at` = max(
  `created_at`,
  coalesce((
    SELECT max(CASE
      WHEN `agent_session_message`.`role` = 'user' THEN `agent_session_message`.`created_at`
      WHEN `agent_session_message`.`role` = 'assistant'
        THEN max(
          `agent_session_message`.`created_at`,
          coalesce(`agent_session_message`.`terminal_at`, `agent_session_message`.`created_at`)
        )
      ELSE NULL
    END)
    FROM `agent_session_message`
    WHERE `agent_session_message`.`session_id` = `agent_session`.`id`
  ), `created_at`)
);--> statement-breakpoint
CREATE INDEX `agent_session_created_at_id_idx` ON `agent_session` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_id_idx` ON `agent_session` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_created_at_id_idx` ON `topic` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_last_activity_at_id_idx` ON `topic` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_created_at_id_idx` ON `topic` (`assistant_id`,"created_at" desc,`id`);

DROP INDEX `agent_session_updated_at_idx`;--> statement-breakpoint
-- SQLite cannot add a NOT NULL column without a DB default to a populated table.
-- Add it in place, then backfill every existing row below; Drizzle supplies future values.
ALTER TABLE `agent_session` ADD `last_activity_at` integer;--> statement-breakpoint
DROP INDEX `topic_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `last_activity_at` integer;--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `activity_at` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `activity_at` integer;--> statement-breakpoint
UPDATE `agent_session_message`
SET `activity_at` = CASE
	WHEN `role` = 'user' THEN `created_at`
	WHEN `role` = 'assistant' AND `status` IN ('success', 'error', 'paused') THEN max(`created_at`, `updated_at`)
	WHEN `role` = 'assistant' THEN `created_at`
	ELSE NULL
END;--> statement-breakpoint
UPDATE `message`
SET `activity_at` = CASE
	WHEN `role` = 'user' THEN `created_at`
	WHEN `role` = 'assistant' AND `status` IN ('success', 'error', 'paused') THEN max(`created_at`, `updated_at`)
	WHEN `role` = 'assistant' THEN `created_at`
	ELSE NULL
END;--> statement-breakpoint
UPDATE `agent_session`
SET `last_activity_at` = max(
	`created_at`,
	coalesce(
		(SELECT max(`activity_at`) FROM `agent_session_message` WHERE `session_id` = `agent_session`.`id`),
		`created_at`
	)
);--> statement-breakpoint
UPDATE `topic`
SET `last_activity_at` = max(
	`created_at`,
	coalesce(
		(
			SELECT max(`activity_at`)
			FROM `message`
			WHERE `topic_id` = `topic`.`id` AND `deleted_at` IS NULL
		),
		`created_at`
	)
);--> statement-breakpoint
CREATE INDEX `agent_session_created_at_id_idx` ON `agent_session` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_id_idx` ON `agent_session` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_created_at_id_idx` ON `topic` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_last_activity_at_id_idx` ON `topic` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_message_session_activity_idx` ON `agent_session_message` (`session_id`,`activity_at`);--> statement-breakpoint
CREATE INDEX `message_topic_activity_idx` ON `message` (`topic_id`,`activity_at`);

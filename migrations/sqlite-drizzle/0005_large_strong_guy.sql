DROP INDEX `agent_session_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `last_activity_at` integer;--> statement-breakpoint
UPDATE `agent_session`
SET `last_activity_at` = max(
	`created_at`,
	coalesce((
		SELECT max(CASE
			WHEN `agent_session_message`.`role` IN ('user', 'assistant') THEN `agent_session_message`.`created_at`
			ELSE NULL
		END)
		FROM `agent_session_message`
		WHERE `agent_session_message`.`session_id` = `agent_session`.`id`
	), `created_at`)
);--> statement-breakpoint
CREATE INDEX `agent_session_created_at_id_idx` ON `agent_session` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_id_idx` ON `agent_session` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_agent_id_last_activity_at_id_idx` ON `agent_session` (`agent_id`,"last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
DROP INDEX `topic_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `last_activity_at` integer;--> statement-breakpoint
UPDATE `topic`
SET `last_activity_at` = max(
	`created_at`,
	coalesce((
		SELECT max(CASE
			WHEN `message`.`role` IN ('user', 'assistant') THEN `message`.`created_at`
			ELSE NULL
		END)
		FROM `message`
		WHERE `message`.`topic_id` = `topic`.`id`
			AND `message`.`deleted_at` IS NULL
	), `created_at`)
);--> statement-breakpoint
CREATE INDEX `topic_created_at_id_idx` ON `topic` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_last_activity_at_id_idx` ON `topic` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_created_at_id_idx` ON `topic` (`assistant_id`,"created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_last_activity_at_id_idx` ON `topic` (`assistant_id`,"last_activity_at" desc,`id`);--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `terminal_at` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `terminal_at` integer;

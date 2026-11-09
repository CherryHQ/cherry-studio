CREATE TABLE `agent_session_message_part` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `agent_session_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_part_message_seq_uniq` ON `agent_session_message_part` (`message_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_session_message_part_session_idx` ON `agent_session_message_part` (`session_id`);--> statement-breakpoint
-- The old trigger recomputes searchable_text from `data.parts`; drop it before the body moves out.
-- Boot custom SQL recreates the FTS triggers against the new contract.
DROP TRIGGER IF EXISTS `agent_session_message_au`;--> statement-breakpoint
INSERT INTO `agent_session_message_part` (`id`, `message_id`, `session_id`, `seq`, `type`, `payload`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
		substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`message`.`id`,
	`message`.`session_id`,
	`part`.`key`,
	coalesce(json_extract(`part`.`value`, '$.type'), ''),
	`part`.`value`,
	`message`.`created_at`,
	`message`.`updated_at`
FROM `agent_session_message` AS `message`, json_each(`message`.`data`, '$.parts') AS `part`;--> statement-breakpoint
UPDATE `agent_session_message` SET `data` = json_remove(`data`, '$.parts') WHERE json_type(`data`, '$.parts') IS NOT NULL;

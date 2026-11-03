ALTER TABLE `agent_session_message` ADD `input_context_id` text REFERENCES agent_session_context(id);--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `native_input_id` text;--> statement-breakpoint
UPDATE `agent_session_message` SET
  `input_context_id` = json_extract(`submission`, '$.contextId'),
  `native_input_id` = json_extract(`submission`, '$.nativeInputId')
WHERE `submission` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_native_input_uniq` ON `agent_session_message` (`input_context_id`,`native_input_id`);--> statement-breakpoint
ALTER TABLE `agent_session_message` DROP COLUMN `submission`;

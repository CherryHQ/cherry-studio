ALTER TABLE `agent_runtime_backend` ADD `needs_recovery_check` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_runtime_backend_recovery_idx` ON `agent_runtime_backend` (`id`) WHERE "agent_runtime_backend"."needs_recovery_check" = 1;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_session_message_reply_idx` ON `agent_session_message` (`session_id`,`reply_id`) WHERE "agent_session_message"."reply_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_session_message_pending_reply_idx` ON `agent_session_message` (`session_id`) WHERE "agent_session_message"."role" = 'assistant' AND "agent_session_message"."status" = 'pending';
--> statement-breakpoint
UPDATE `agent_runtime_backend` SET `needs_recovery_check` = 1 WHERE `state` = 'bound' AND json_extract(`locator`, '$.kind') = 'pi-durable';

ALTER TABLE `ai_usage_record` ADD `agent_session_id` text;--> statement-breakpoint
CREATE INDEX `ai_usage_record_session_created_idx` ON `ai_usage_record` (`agent_session_id`,`created_at`);
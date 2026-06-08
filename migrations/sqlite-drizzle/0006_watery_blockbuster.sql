DROP INDEX `message_trace_id_idx`;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `trace_id`;--> statement-breakpoint
ALTER TABLE `agent` ADD `disabled_tools` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent` DROP COLUMN `allowed_tools`;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `topic` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `agent_session_message` DROP COLUMN `trace_id`;
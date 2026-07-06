ALTER TABLE `agent_session_message` ADD `message_snapshot` text;--> statement-breakpoint
ALTER TABLE `agent_session_message` DROP COLUMN `model_snapshot`;--> statement-breakpoint
ALTER TABLE `message` ADD `message_snapshot` text;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `model_snapshot`;
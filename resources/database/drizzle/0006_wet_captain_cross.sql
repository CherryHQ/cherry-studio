ALTER TABLE `channels` ADD `active_chat_ids` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `scheduled_tasks` DROP COLUMN `context_mode`;
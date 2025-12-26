ALTER TABLE `message` ADD `stats` text;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `usage`;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `metrics`;
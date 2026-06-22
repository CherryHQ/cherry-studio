ALTER TABLE `agent` ADD `disabled_tools` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent` DROP COLUMN `allowed_tools`;

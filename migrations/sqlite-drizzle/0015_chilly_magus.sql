ALTER TABLE `mini_app` RENAME COLUMN "logo" TO "logo_key";--> statement-breakpoint
ALTER TABLE `mini_app` ADD `logo_file_id` text REFERENCES file_entry(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `user_provider` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `user_provider` ADD `logo_file_id` text REFERENCES file_entry(id) ON DELETE SET NULL;
ALTER TABLE `mini_app` ADD `logo_file_id` text REFERENCES file_entry(id);--> statement-breakpoint
ALTER TABLE `user_provider` ADD `logo_file_id` text REFERENCES file_entry(id);
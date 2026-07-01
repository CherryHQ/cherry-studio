CREATE TABLE `mini_app_logo_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "malfr_role_check" CHECK("mini_app_logo_file_ref"."role" IN ('logo'))
);
--> statement-breakpoint
CREATE INDEX `malfr_entry_id_idx` ON `mini_app_logo_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `malfr_source_id_role_idx` ON `mini_app_logo_file_ref` (`source_id`,`role`);--> statement-breakpoint
CREATE TABLE `provider_logo_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plfr_role_check" CHECK("provider_logo_file_ref"."role" IN ('logo'))
);
--> statement-breakpoint
CREATE INDEX `plfr_entry_id_idx` ON `provider_logo_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plfr_source_id_role_idx` ON `provider_logo_file_ref` (`source_id`,`role`);--> statement-breakpoint
CREATE TABLE `user_avatar_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "uafr_role_check" CHECK("user_avatar_file_ref"."role" IN ('avatar'))
);
--> statement-breakpoint
CREATE INDEX `uafr_entry_id_idx` ON `user_avatar_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uafr_source_id_role_idx` ON `user_avatar_file_ref` (`source_id`,`role`);--> statement-breakpoint
ALTER TABLE `mini_app` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `mini_app` ADD `logo_file_id` text REFERENCES file_entry(id);--> statement-breakpoint
ALTER TABLE `mini_app` DROP COLUMN `logo`;--> statement-breakpoint
ALTER TABLE `user_provider` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `user_provider` ADD `logo_file_id` text REFERENCES file_entry(id);
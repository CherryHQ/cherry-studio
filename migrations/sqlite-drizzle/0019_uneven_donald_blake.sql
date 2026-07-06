PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mini_app_logo_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `mini_app`(`app_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_mini_app_logo_file_ref`("id", "file_entry_id", "source_id", "created_at", "updated_at") SELECT "id", "file_entry_id", "source_id", "created_at", "updated_at" FROM `mini_app_logo_file_ref`;--> statement-breakpoint
DROP TABLE `mini_app_logo_file_ref`;--> statement-breakpoint
ALTER TABLE `__new_mini_app_logo_file_ref` RENAME TO `mini_app_logo_file_ref`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `malfr_entry_id_idx` ON `mini_app_logo_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `malfr_source_id_idx` ON `mini_app_logo_file_ref` (`source_id`);--> statement-breakpoint
CREATE TABLE `__new_provider_logo_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `user_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_provider_logo_file_ref`("id", "file_entry_id", "source_id", "created_at", "updated_at") SELECT "id", "file_entry_id", "source_id", "created_at", "updated_at" FROM `provider_logo_file_ref`;--> statement-breakpoint
DROP TABLE `provider_logo_file_ref`;--> statement-breakpoint
ALTER TABLE `__new_provider_logo_file_ref` RENAME TO `provider_logo_file_ref`;--> statement-breakpoint
CREATE INDEX `plfr_entry_id_idx` ON `provider_logo_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plfr_source_id_idx` ON `provider_logo_file_ref` (`source_id`);
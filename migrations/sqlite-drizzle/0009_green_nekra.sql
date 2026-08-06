CREATE TABLE `translate_history_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `translate_history`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thfr_role_check" CHECK("translate_history_file_ref"."role" IN ('source', 'target'))
);
--> statement-breakpoint
CREATE INDEX `thfr_entry_id_idx` ON `translate_history_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `thfr_source_id_idx` ON `translate_history_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thfr_unique_idx` ON `translate_history_file_ref` (`file_entry_id`,`source_id`,`role`);--> statement-breakpoint
ALTER TABLE `translate_history` ADD `kind` text DEFAULT 'text' NOT NULL;
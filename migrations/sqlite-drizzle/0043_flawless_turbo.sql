CREATE TABLE IF NOT EXISTS `followup_queue_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `followup_queue`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fqfr_role_check" CHECK("followup_queue_file_ref"."role" IN ('attachment'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fqfr_entry_id_idx` ON `followup_queue_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fqfr_source_id_idx` ON `followup_queue_file_ref` (`source_id`);
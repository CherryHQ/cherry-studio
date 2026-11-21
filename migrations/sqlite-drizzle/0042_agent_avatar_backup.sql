CREATE TABLE `agent_avatar_backup` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text,
	`source_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agab_entry_id_idx` ON `agent_avatar_backup` (`file_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agab_source_id_idx` ON `agent_avatar_backup` (`source_id`);
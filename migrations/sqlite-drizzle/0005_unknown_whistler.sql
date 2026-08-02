PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chat_message_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cmfr_role_check" CHECK("__new_chat_message_file_ref"."role" IN ('attachment', 'tool_output'))
);
--> statement-breakpoint
INSERT INTO `__new_chat_message_file_ref`("id", "file_entry_id", "source_id", "role", "created_at", "updated_at") SELECT "id", "file_entry_id", "source_id", "role", "created_at", "updated_at" FROM `chat_message_file_ref`;--> statement-breakpoint
DROP TABLE `chat_message_file_ref`;--> statement-breakpoint
ALTER TABLE `__new_chat_message_file_ref` RENAME TO `chat_message_file_ref`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cmfr_entry_id_idx` ON `chat_message_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `cmfr_source_id_idx` ON `chat_message_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cmfr_unique_idx` ON `chat_message_file_ref` (`file_entry_id`,`source_id`,`role`);
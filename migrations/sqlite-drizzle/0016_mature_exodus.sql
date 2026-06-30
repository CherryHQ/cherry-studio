CREATE TABLE `chat_message_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cmfr_role_check" CHECK("chat_message_file_ref"."role" IN ('attachment'))
);
--> statement-breakpoint
CREATE INDEX `cmfr_entry_id_idx` ON `chat_message_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `cmfr_source_id_idx` ON `chat_message_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cmfr_unique_idx` ON `chat_message_file_ref` (`file_entry_id`,`source_id`,`role`);--> statement-breakpoint
CREATE TABLE `painting_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `painting`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pfr_role_check" CHECK("painting_file_ref"."role" IN ('output', 'input'))
);
--> statement-breakpoint
CREATE INDEX `pfr_entry_id_idx` ON `painting_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `pfr_source_id_idx` ON `painting_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pfr_unique_idx` ON `painting_file_ref` (`file_entry_id`,`source_id`,`role`);--> statement-breakpoint
DROP TABLE `file_ref`;
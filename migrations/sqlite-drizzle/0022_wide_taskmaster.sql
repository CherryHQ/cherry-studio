CREATE TABLE `creation` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`prompt` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creation_order_key_idx` ON `creation` (`order_key`);--> statement-breakpoint
CREATE TABLE `creation_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `creation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crfr_role_check" CHECK("creation_file_ref"."role" IN ('output', 'input'))
);
--> statement-breakpoint
CREATE INDEX `crfr_entry_id_idx` ON `creation_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `crfr_source_id_idx` ON `creation_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `crfr_unique_idx` ON `creation_file_ref` (`file_entry_id`,`source_id`,`role`);--> statement-breakpoint
DROP TABLE `painting_file_ref`;--> statement-breakpoint
DROP TABLE `painting`;
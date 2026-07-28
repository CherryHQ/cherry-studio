CREATE TABLE `learning_unit_dedup_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`learning_source_id` text,
	`matched_unit_id` text,
	`resulting_unit_id` text,
	`candidate_english` text NOT NULL,
	`candidate_meaning` text NOT NULL,
	`decision` text NOT NULL,
	`confidence` real NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`learning_source_id`) REFERENCES `learning_source`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_unit_id`) REFERENCES `learning_unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resulting_unit_id`) REFERENCES `learning_unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `learning_unit_dedup_source_id_idx` ON `learning_unit_dedup_decision` (`learning_source_id`);--> statement-breakpoint
CREATE INDEX `learning_unit_dedup_resulting_unit_id_idx` ON `learning_unit_dedup_decision` (`resulting_unit_id`);
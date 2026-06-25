CREATE TABLE `input_history` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `input_history_content_unique_idx` ON `input_history` (`content`);--> statement-breakpoint
CREATE INDEX `input_history_updated_at_idx` ON `input_history` (`updated_at`);
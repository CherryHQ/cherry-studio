CREATE TABLE `ocr_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capabilities` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `name` ON `ocr_provider` (`name`);
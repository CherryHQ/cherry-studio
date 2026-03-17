CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`relative_path` text NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_relative_path_unique` ON `note` (`relative_path`);
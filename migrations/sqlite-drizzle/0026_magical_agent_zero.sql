CREATE TABLE `note_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`path` text NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_expanded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_metadata_root_path_path_unique_idx` ON `note_metadata` (`root_path`,`path`);

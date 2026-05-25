CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`path` text NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_expanded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "note_has_state_check" CHECK("note"."is_starred" = 1 OR "note"."is_expanded" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_root_path_path_unique_idx` ON `note` (`root_path`,`path`);

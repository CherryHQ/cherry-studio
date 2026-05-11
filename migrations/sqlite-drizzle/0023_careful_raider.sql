CREATE TABLE `file_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`size` integer,
	`external_path` text,
	`trashed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "fe_origin_check" CHECK("file_entry"."origin" IN ('internal', 'external')),
	CONSTRAINT "fe_origin_consistency" CHECK(("file_entry"."origin" = 'internal' AND "file_entry"."external_path" IS NULL) OR ("file_entry"."origin" = 'external' AND "file_entry"."external_path" IS NOT NULL)),
	CONSTRAINT "fe_external_no_trash" CHECK("file_entry"."origin" != 'external' OR "file_entry"."trashed_at" IS NULL),
	CONSTRAINT "fe_size_internal_only" CHECK(("file_entry"."origin" = 'internal' AND "file_entry"."size" IS NOT NULL AND "file_entry"."size" >= 0) OR ("file_entry"."origin" = 'external' AND "file_entry"."size" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `fe_trashed_at_idx` ON `file_entry` (`trashed_at`);--> statement-breakpoint
CREATE INDEX `fe_created_at_idx` ON `file_entry` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `fe_external_path_unique_idx` ON `file_entry` (`external_path`);--> statement-breakpoint
CREATE TABLE `file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_ref_entry_id_idx` ON `file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `file_ref_source_idx` ON `file_ref` (`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_ref_unique_idx` ON `file_ref` (`file_entry_id`,`source_type`,`source_id`,`role`);
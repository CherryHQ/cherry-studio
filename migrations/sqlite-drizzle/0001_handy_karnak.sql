CREATE TABLE `job_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jfr_role_check" CHECK("job_file_ref"."role" IN ('input', 'mask'))
);
--> statement-breakpoint
CREATE INDEX `jfr_entry_id_idx` ON `job_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `jfr_source_id_idx` ON `job_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jfr_unique_idx` ON `job_file_ref` (`file_entry_id`,`source_id`,`role`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`size` integer,
	`external_path` text,
	`cleanup_policy` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "fe_origin_check" CHECK("__new_file_entry"."origin" IN ('internal', 'external')),
	CONSTRAINT "fe_cleanup_policy_check" CHECK("__new_file_entry"."cleanup_policy" IN ('manual', 'delete_when_unreferenced')),
	CONSTRAINT "fe_origin_consistency" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."external_path" IS NULL) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."external_path" IS NOT NULL)),
	CONSTRAINT "fe_external_no_delete" CHECK("__new_file_entry"."origin" != 'external' OR "__new_file_entry"."deleted_at" IS NULL),
	CONSTRAINT "fe_size_internal_only" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."size" IS NOT NULL AND "__new_file_entry"."size" >= 0) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."size" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_file_entry`("id", "origin", "name", "ext", "size", "external_path", "created_at", "updated_at", "deleted_at") SELECT "id", "origin", "name", "ext", "size", "external_path", "created_at", "updated_at", "deleted_at" FROM `file_entry`;--> statement-breakpoint
DROP TABLE `file_entry`;--> statement-breakpoint
ALTER TABLE `__new_file_entry` RENAME TO `file_entry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fe_deleted_at_idx` ON `file_entry` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `fe_created_at_idx` ON `file_entry` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `fe_external_path_lower_unique_idx` ON `file_entry` (lower("external_path"));--> statement-breakpoint
CREATE INDEX `fe_external_path_idx` ON `file_entry` (`external_path`);
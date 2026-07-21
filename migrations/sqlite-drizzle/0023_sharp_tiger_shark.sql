PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`size` integer,
	`content_hash` text,
	`external_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "fe_origin_check" CHECK("__new_file_entry"."origin" IN ('internal', 'external')),
	CONSTRAINT "fe_origin_consistency" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."external_path" IS NULL) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."external_path" IS NOT NULL)),
	CONSTRAINT "fe_external_no_delete" CHECK("__new_file_entry"."origin" != 'external' OR "__new_file_entry"."deleted_at" IS NULL),
	CONSTRAINT "fe_contenthash_external_null" CHECK("__new_file_entry"."origin" != 'external' OR "__new_file_entry"."content_hash" IS NULL),
	CONSTRAINT "fe_size_internal_only" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."size" IS NOT NULL AND "__new_file_entry"."size" >= 0) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."size" IS NULL))
);
--> statement-breakpoint
-- MANUAL PATCH: drizzle-kit includes the newly-added column in the rebuild
-- SELECT even though it does not exist on the old table. Omitting it leaves
-- migrated rows at the intended NULL backfill-window state.
INSERT INTO `__new_file_entry`("id", "origin", "name", "ext", "size", "external_path", "created_at", "updated_at", "deleted_at") SELECT "id", "origin", "name", "ext", "size", "external_path", "created_at", "updated_at", "deleted_at" FROM `file_entry`;--> statement-breakpoint
DROP TABLE `file_entry`;--> statement-breakpoint
ALTER TABLE `__new_file_entry` RENAME TO `file_entry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fe_deleted_at_idx` ON `file_entry` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `fe_created_at_idx` ON `file_entry` (`created_at`);--> statement-breakpoint
CREATE INDEX `fe_content_hash_idx` ON `file_entry` (`content_hash`);--> statement-breakpoint
-- MANUAL PATCH: drizzle-kit quotes the whole functional-index expression as
-- an identifier. Restore the expression used by the existing schema.
CREATE UNIQUE INDEX `fe_external_path_lower_unique_idx` ON `file_entry` (lower("external_path"));--> statement-breakpoint
CREATE INDEX `fe_external_path_idx` ON `file_entry` (`external_path`);

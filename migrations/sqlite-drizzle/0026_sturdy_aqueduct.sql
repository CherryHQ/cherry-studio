-- MANUAL PATCH: workaround for drizzle-orm/drizzle-kit #3653
-- (rebuild-table path drops the leading ALTER TABLE RENAME COLUMN statement,
-- so the INSERT ... SELECT below references "deleted_at" on the old table
-- which still has the column named "trashed_at" and would fail with
-- "no such column: deleted_at". Fix per yume-chan's patch suggestion.)
-- https://github.com/drizzle-team/drizzle-orm/issues/3653
ALTER TABLE `file_entry` RENAME COLUMN `trashed_at` TO `deleted_at`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`size` integer,
	`external_path` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "fe_origin_check" CHECK("__new_file_entry"."origin" IN ('internal', 'external')),
	CONSTRAINT "fe_origin_consistency" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."external_path" IS NULL) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."external_path" IS NOT NULL)),
	CONSTRAINT "fe_external_no_delete" CHECK("__new_file_entry"."origin" != 'external' OR "__new_file_entry"."deleted_at" IS NULL),
	CONSTRAINT "fe_size_internal_only" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."size" IS NOT NULL AND "__new_file_entry"."size" >= 0) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."size" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_file_entry`("id", "origin", "name", "ext", "size", "external_path", "deleted_at", "created_at", "updated_at") SELECT "id", "origin", "name", "ext", "size", "external_path", "deleted_at", "created_at", "updated_at" FROM `file_entry`;--> statement-breakpoint
DROP TABLE `file_entry`;--> statement-breakpoint
ALTER TABLE `__new_file_entry` RENAME TO `file_entry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fe_deleted_at_idx` ON `file_entry` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `fe_created_at_idx` ON `file_entry` (`created_at`);--> statement-breakpoint
-- Functional index on `lower(external_path)`. drizzle-kit's rebuild path
-- wraps the whole expression in backticks (`lower("external_path")`) which
-- SQLite reads as a single quoted identifier instead of a function call;
-- preserve the original 0023 syntax — bare `lower("external_path")` — by hand.
CREATE UNIQUE INDEX `fe_external_path_lower_unique_idx` ON `file_entry` (lower("external_path"));--> statement-breakpoint
CREATE INDEX `fe_external_path_idx` ON `file_entry` (`external_path`);
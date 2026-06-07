PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`size` integer,
	`external_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "fe_origin_check" CHECK("__new_file_entry"."origin" IN ('internal', 'external')),
	CONSTRAINT "fe_origin_consistency" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."external_path" IS NULL) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."external_path" IS NOT NULL)),
	CONSTRAINT "fe_external_no_delete" CHECK("__new_file_entry"."origin" != 'external' OR "__new_file_entry"."deleted_at" IS NULL),
	CONSTRAINT "fe_size_internal_only" CHECK(("__new_file_entry"."origin" = 'internal' AND "__new_file_entry"."size" IS NOT NULL AND "__new_file_entry"."size" >= 0) OR ("__new_file_entry"."origin" = 'external' AND "__new_file_entry"."size" IS NULL)),
	CONSTRAINT "fe_name_no_separators" CHECK(instr("__new_file_entry"."name", '/') = 0 AND instr("__new_file_entry"."name", char(92)) = 0),
	CONSTRAINT "fe_name_not_blank" CHECK(length(trim("__new_file_entry"."name")) > 0),
	CONSTRAINT "fe_ext_no_separators" CHECK("__new_file_entry"."ext" IS NULL OR (instr("__new_file_entry"."ext", '/') = 0 AND instr("__new_file_entry"."ext", char(92)) = 0))
);
--> statement-breakpoint
INSERT INTO `__new_file_entry`("id", "origin", "name", "ext", "size", "external_path", "created_at", "updated_at", "deleted_at") SELECT "id", "origin", "name", "ext", "size", "external_path", "created_at", "updated_at", "deleted_at" FROM `file_entry`;--> statement-breakpoint
DROP TABLE `file_entry`;--> statement-breakpoint
ALTER TABLE `__new_file_entry` RENAME TO `file_entry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fe_deleted_at_idx` ON `file_entry` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `fe_created_at_idx` ON `file_entry` (`created_at`);--> statement-breakpoint
-- drizzle-kit's table-recreate path wrongly emits the functional index expression as a
-- backtick-quoted identifier (`lower("external_path")`), which fails with "no such column".
-- Hand-fixed to the bare expression form (matching 0000). Snapshot is untouched, so
-- `db:migrations:generate` stays a no-op and CI's drift check passes. Recurs on any future
-- file_entry recreate until the pre-release migration wipe-and-regenerate.
CREATE UNIQUE INDEX `fe_external_path_lower_unique_idx` ON `file_entry` (lower("external_path"));--> statement-breakpoint
CREATE INDEX `fe_external_path_idx` ON `file_entry` (`external_path`);--> statement-breakpoint
CREATE TABLE `__new_knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_id` text,
	`dimensions` integer,
	`embedding_model_id` text,
	`status` text NOT NULL,
	`error` text,
	`rerank_model_id` text,
	`file_processor_id` text,
	`chunk_size` integer NOT NULL,
	`chunk_overlap` integer NOT NULL,
	`threshold` real,
	`document_count` integer,
	`search_mode` text NOT NULL,
	`hybrid_alpha` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`embedding_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rerank_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("__new_knowledge_base"."search_mode" IN ('default', 'bm25', 'hybrid')),
	CONSTRAINT "knowledge_base_status_check" CHECK("__new_knowledge_base"."status" IN ('completed', 'failed')),
	CONSTRAINT "knowledge_base_status_error_check" CHECK(
        (
          "__new_knowledge_base"."status" = 'completed'
          AND "__new_knowledge_base"."embedding_model_id" IS NOT NULL
          AND "__new_knowledge_base"."dimensions" IS NOT NULL
          AND "__new_knowledge_base"."dimensions" > 0
          AND "__new_knowledge_base"."error" IS NULL
        )
        OR (
          "__new_knowledge_base"."status" = 'failed'
          AND "__new_knowledge_base"."error" IS NOT NULL
          AND length(trim("__new_knowledge_base"."error")) > 0
        )
      ),
	CONSTRAINT "knowledge_base_name_not_blank" CHECK(length(trim("__new_knowledge_base"."name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_base`("id", "name", "group_id", "dimensions", "embedding_model_id", "status", "error", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "threshold", "document_count", "search_mode", "hybrid_alpha", "created_at", "updated_at") SELECT "id", "name", "group_id", "dimensions", "embedding_model_id", "status", "error", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "threshold", "document_count", "search_mode", "hybrid_alpha", "created_at", "updated_at" FROM `knowledge_base`;--> statement-breakpoint
DROP TABLE `knowledge_base`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_base` RENAME TO `knowledge_base`;
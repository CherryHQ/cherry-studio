PRAGMA foreign_keys=OFF;--> statement-breakpoint
DELETE FROM `knowledge_item` WHERE `base_id` IN (SELECT `id` FROM `knowledge_base` WHERE `embedding_model_id` IS NULL OR `embedding_model_id` NOT IN (SELECT `id` FROM `user_model`));--> statement-breakpoint
DELETE FROM `knowledge_base` WHERE `embedding_model_id` IS NULL OR `embedding_model_id` NOT IN (SELECT `id` FROM `user_model`);--> statement-breakpoint
CREATE TABLE `__new_knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_id` text,
	`emoji` text NOT NULL,
	`dimensions` integer NOT NULL,
	`embedding_model_id` text NOT NULL,
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
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("__new_knowledge_base"."search_mode" IN ('default', 'bm25', 'hybrid'))
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_base`("id", "name", "group_id", "emoji", "dimensions", "embedding_model_id", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "threshold", "document_count", "search_mode", "hybrid_alpha", "created_at", "updated_at") SELECT "id", "name", NULL, '📁', "dimensions", "embedding_model_id", "rerank_model_id", "file_processor_id", CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END, CASE WHEN "chunk_overlap" IS NOT NULL AND "chunk_overlap" >= 0 AND "chunk_overlap" < CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END THEN "chunk_overlap" WHEN CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END <= 1 THEN 0 WHEN CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END <= 200 THEN CASE WHEN "chunk_size" IS NOT NULL AND "chunk_size" > 0 THEN "chunk_size" ELSE 1024 END - 1 ELSE 200 END, "threshold", "document_count", CASE WHEN "search_mode" IN ('default', 'bm25', 'hybrid') THEN "search_mode" ELSE 'hybrid' END, "hybrid_alpha", "created_at", "updated_at" FROM `knowledge_base`;--> statement-breakpoint
DROP TABLE `knowledge_base`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_base` RENAME TO `knowledge_base`;--> statement-breakpoint
CREATE TABLE `__new_knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`phase` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("__new_knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory')),
	CONSTRAINT "knowledge_item_status_check" CHECK("__new_knowledge_item"."status" IN ('idle', 'processing', 'completed', 'failed')),
	CONSTRAINT "knowledge_item_phase_check" CHECK(
		"__new_knowledge_item"."phase" IS NULL
		OR ("__new_knowledge_item"."type" IN ('file', 'url', 'note') AND "__new_knowledge_item"."phase" IN ('reading', 'embedding'))
		OR ("__new_knowledge_item"."type" IN ('directory', 'sitemap') AND "__new_knowledge_item"."phase" = 'preparing')
	),
	CONSTRAINT "knowledge_item_status_phase_error_check" CHECK(
		("__new_knowledge_item"."status" IN ('idle', 'completed') AND "__new_knowledge_item"."phase" IS NULL AND "__new_knowledge_item"."error" IS NULL)
		OR ("__new_knowledge_item"."status" = 'processing' AND "__new_knowledge_item"."error" IS NULL)
		OR ("__new_knowledge_item"."status" = 'failed' AND "__new_knowledge_item"."phase" IS NULL AND "__new_knowledge_item"."error" IS NOT NULL AND length(trim("__new_knowledge_item"."error")) > 0)
	)
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_item`("id", "base_id", "group_id", "type", "data", "status", "phase", "error", "created_at", "updated_at") SELECT "id", "base_id", "group_id", "type", "data", CASE WHEN "status" IN ('pending', 'processing', 'file_processing', 'read', 'embed') THEN 'failed' WHEN "status" IN ('idle', 'completed') THEN "status" WHEN "status" = 'failed' AND NULLIF("error", '') IS NOT NULL THEN 'failed' ELSE 'idle' END, NULL, CASE WHEN "status" IN ('pending', 'processing', 'file_processing', 'read', 'embed') THEN COALESCE(NULLIF("error", ''), 'Knowledge item processing was interrupted by migration. Please reindex this item.') WHEN "status" = 'failed' AND NULLIF("error", '') IS NOT NULL THEN "error" ELSE NULL END, "created_at", "updated_at" FROM `knowledge_item` WHERE "base_id" IN (SELECT `id` FROM `knowledge_base`);--> statement-breakpoint
DROP TABLE `knowledge_item`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_item` RENAME TO `knowledge_item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);

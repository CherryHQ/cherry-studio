PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`chunk_strategy` text DEFAULT 'structured' NOT NULL,
	`chunk_separator` text DEFAULT '\n\n' NOT NULL,
	`threshold` real,
	`document_count` integer,
	`search_mode` text NOT NULL,
	`hybrid_alpha` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`embedding_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rerank_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("__new_knowledge_base"."search_mode" IN ('vector', 'bm25', 'hybrid')),
	CONSTRAINT "knowledge_base_chunk_strategy_check" CHECK("__new_knowledge_base"."chunk_strategy" IN ('structured', 'delimiter')),
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
      )
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_base`("id", "name", "group_id", "dimensions", "embedding_model_id", "status", "error", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "threshold", "document_count", "search_mode", "hybrid_alpha", "created_at", "updated_at") SELECT "id", "name", "group_id", "dimensions", "embedding_model_id", "status", "error", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "threshold", "document_count", "search_mode", "hybrid_alpha", "created_at", "updated_at" FROM `knowledge_base`;--> statement-breakpoint
DROP TABLE `knowledge_base`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_base` RENAME TO `knowledge_base`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
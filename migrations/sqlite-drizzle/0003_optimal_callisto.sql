CREATE TABLE `knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`dimensions` integer NOT NULL,
	`embedding_model_id` text NOT NULL,
	`embedding_model_meta` text,
	`rerank_model_id` text,
	`rerank_model_meta` text,
	`file_processor_id` text,
	`chunk_size` integer,
	`chunk_overlap` integer,
	`threshold` real,
	`document_count` integer,
	`search_mode` text,
	`hybrid_alpha` real,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("knowledge_base"."search_mode" IS NULL OR "knowledge_base"."search_mode" IN ('default', 'bm25', 'hybrid'))
);
--> statement-breakpoint
CREATE TABLE `knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'idle',
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `knowledge_item`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_status_check" CHECK("knowledge_item"."status" IN ('idle', 'pending', 'ocr', 'read', 'embed', 'completed', 'failed')),
	CONSTRAINT "knowledge_item_type_check" CHECK("knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory'))
);
--> statement-breakpoint
CREATE INDEX `knowledge_item_base_id_idx` ON `knowledge_item` (`base_id`);

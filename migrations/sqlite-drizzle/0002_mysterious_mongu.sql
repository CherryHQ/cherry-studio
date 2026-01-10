CREATE TABLE `knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`embedding_model_id` text NOT NULL,
	`embedding_model_meta` text,
	`rerank_model_id` text,
	`rerank_model_meta` text,
	`preprocess_provider_id` text,
	`chunk_size` integer,
	`chunk_overlap` integer,
	`threshold` real,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'idle',
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_status_check" CHECK("knowledge_item"."status" IN ('idle', 'pending', 'preprocessing', 'embedding', 'completed', 'failed')),
	CONSTRAINT "knowledge_item_type_check" CHECK("knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory'))
);

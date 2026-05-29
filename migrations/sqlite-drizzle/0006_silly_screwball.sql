CREATE TABLE `knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`dimensions` integer NOT NULL,
	`embedding_model_id` text NOT NULL,
	`rerank_model_id` text,
	`file_processor_id` text,
	`chunk_size` integer,
	`chunk_overlap` integer,
	`threshold` real,
	`document_count` integer,
	`search_mode` text,
	`hybrid_alpha` real,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "knowledge_base_search_mode_check" CHECK("knowledge_base"."search_mode" IN ('default', 'bm25', 'hybrid') OR "knowledge_base"."search_mode" IS NULL)
);
--> statement-breakpoint
CREATE TABLE `knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("knowledge_item"."type" IN ('file', 'url', 'note', 'sitemap', 'directory')),
	CONSTRAINT "knowledge_item_status_check" CHECK("knowledge_item"."status" IN ('idle', 'pending', 'file_processing', 'read', 'embed', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);

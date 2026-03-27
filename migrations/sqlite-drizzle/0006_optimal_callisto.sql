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
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL DEFAULT 'idle',
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`parent_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_base_id_id_unique" UNIQUE(`base_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `knowledge_item_base_parent_created_idx` ON `knowledge_item` (`base_id`,`parent_id`,`created_at`);

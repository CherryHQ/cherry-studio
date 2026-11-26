CREATE TABLE `knowledge_chunk_governance_history` (
	`id` text PRIMARY KEY NOT NULL,
	`governance_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`governance_id`) REFERENCES `knowledge_chunk_governance`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_chunk_governance_history_revision_check" CHECK("knowledge_chunk_governance_history"."revision" >= 1),
	CONSTRAINT "knowledge_chunk_governance_history_state_check" CHECK(json_valid("knowledge_chunk_governance_history"."state"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_chunk_governance_history_revision_unique` ON `knowledge_chunk_governance_history` (`governance_id`,`revision`);--> statement-breakpoint
CREATE TABLE `knowledge_chunk_governance` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`source_content_hash` text NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`original_text` text NOT NULL,
	`original_text_hash` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`,`item_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_chunk_governance_offsets_check" CHECK("knowledge_chunk_governance"."char_start" >= 0 AND "knowledge_chunk_governance"."char_end" > "knowledge_chunk_governance"."char_start"),
	CONSTRAINT "knowledge_chunk_governance_revision_check" CHECK("knowledge_chunk_governance"."revision" >= 1),
	CONSTRAINT "knowledge_chunk_governance_state_check" CHECK(json_valid("knowledge_chunk_governance"."state"))
);
--> statement-breakpoint
CREATE INDEX `knowledge_chunk_governance_item_idx` ON `knowledge_chunk_governance` (`base_id`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_chunk_governance_unit_unique` ON `knowledge_chunk_governance` (`base_id`,`item_id`,`unit_id`);
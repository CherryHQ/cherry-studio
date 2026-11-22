ALTER TABLE `knowledge_chunk_governance_history` ADD `operation` text DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_chunk_governance_history` ADD `related_governance_id` text;--> statement-breakpoint
ALTER TABLE `knowledge_chunk_governance` ADD `retired` integer DEFAULT false NOT NULL;
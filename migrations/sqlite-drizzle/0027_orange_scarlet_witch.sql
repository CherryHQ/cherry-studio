ALTER TABLE `knowledge_base` ADD `order_key` text DEFAULT 'a0' NOT NULL;--> statement-breakpoint
CREATE INDEX `knowledge_base_group_id_order_key_idx` ON `knowledge_base` (`group_id`,`order_key`);
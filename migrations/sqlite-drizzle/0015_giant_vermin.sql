DROP INDEX `topic_group_sort_idx`;--> statement-breakpoint
DROP INDEX `topic_is_pinned_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `order_key` text NOT NULL;--> statement-breakpoint
CREATE INDEX `topic_group_id_order_key_idx` ON `topic` (`group_id`,`order_key`);--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `is_pinned`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `pinned_order`;
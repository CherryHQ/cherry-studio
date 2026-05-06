DROP INDEX `mini_app_status_sort_idx`;--> statement-breakpoint
ALTER TABLE `mini_app` ADD `order_key` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `mini_app_status_order_key_idx` ON `mini_app` (`status`,`order_key`);--> statement-breakpoint
ALTER TABLE `mini_app` DROP COLUMN `sort_order`;

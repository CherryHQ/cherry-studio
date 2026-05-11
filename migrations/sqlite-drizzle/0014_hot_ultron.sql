CREATE TABLE `pin` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pin_entity_type_entity_id_unique_idx` ON `pin` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `pin_entity_type_order_key_idx` ON `pin` (`entity_type`,`order_key`);--> statement-breakpoint
DROP INDEX `group_entity_sort_idx`;--> statement-breakpoint
ALTER TABLE `group` ADD `order_key` text NOT NULL;--> statement-breakpoint
CREATE INDEX `group_entity_type_order_key_idx` ON `group` (`entity_type`,`order_key`);--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `sort_order`;
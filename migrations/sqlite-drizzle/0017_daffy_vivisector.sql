ALTER TABLE `miniapp` RENAME TO `mini_app`;--> statement-breakpoint
ALTER TABLE `mini_app` RENAME COLUMN "type" TO "kind";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`kind` text DEFAULT 'custom' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("__new_mini_app"."status" IN ('enabled', 'disabled', 'pinned')),
	CONSTRAINT "mini_app_kind_check" CHECK("__new_mini_app"."kind" IN ('default', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_mini_app`("app_id", "name", "url", "logo", "kind", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "name", "url", "logo", "kind", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `mini_app`;--> statement-breakpoint
DROP TABLE `mini_app`;--> statement-breakpoint
ALTER TABLE `__new_mini_app` RENAME TO `mini_app`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mini_app_status_sort_idx` ON `mini_app` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `mini_app_kind_idx` ON `mini_app` (`kind`);--> statement-breakpoint
CREATE INDEX `mini_app_status_kind_idx` ON `mini_app` (`status`,`kind`);--> statement-breakpoint
DROP INDEX `topic_group_sort_idx`;--> statement-breakpoint
DROP INDEX `topic_is_pinned_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `order_key` text NOT NULL;--> statement-breakpoint
CREATE INDEX `topic_group_id_order_key_idx` ON `topic` (`group_id`,`order_key`);--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `is_pinned`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `pinned_order`;
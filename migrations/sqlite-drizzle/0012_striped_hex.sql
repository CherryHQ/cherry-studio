ALTER TABLE `miniapp` RENAME TO `mini_app`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`type` text DEFAULT 'custom' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`sort_order` integer DEFAULT 0,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "mini_app_status_check" CHECK("__new_mini_app"."status" IN ('enabled', 'disabled', 'pinned')),
	CONSTRAINT "mini_app_type_check" CHECK("__new_mini_app"."type" IN ('default', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_mini_app`("app_id", "name", "url", "logo", "type", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "name", "url", "logo", "type", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `mini_app`;--> statement-breakpoint
DROP TABLE `mini_app`;--> statement-breakpoint
ALTER TABLE `__new_mini_app` RENAME TO `mini_app`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mini_app_status_sort_idx` ON `mini_app` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `mini_app_type_idx` ON `mini_app` (`type`);--> statement-breakpoint
CREATE INDEX `mini_app_status_type_idx` ON `mini_app` (`status`,`type`);
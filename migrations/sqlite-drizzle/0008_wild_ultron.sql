PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_miniapp` (
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
	CONSTRAINT "miniapp_status_check" CHECK("__new_miniapp"."status" IN ('enabled', 'disabled', 'pinned')),
	CONSTRAINT "miniapp_type_check" CHECK("__new_miniapp"."type" IN ('default', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_miniapp`("app_id", "name", "url", "logo", "type", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "name", "url", "logo", "type", "status", "sort_order", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `miniapp`;--> statement-breakpoint
DROP TABLE `miniapp`;--> statement-breakpoint
ALTER TABLE `__new_miniapp` RENAME TO `miniapp`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `miniapp_status_sort_idx` ON `miniapp` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `miniapp_type_idx` ON `miniapp` (`type`);--> statement-breakpoint
CREATE INDEX `miniapp_status_type_idx` ON `miniapp` (`status`,`type`);
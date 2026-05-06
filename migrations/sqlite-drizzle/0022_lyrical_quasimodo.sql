DROP INDEX `mini_app_kind_idx`;--> statement-breakpoint
DROP INDEX `mini_app_status_kind_idx`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`preset_miniapp_id` text,
	`name` text,
	`url` text,
	`logo` text,
	`status` text DEFAULT 'enabled' NOT NULL,
	`order_key` text NOT NULL,
	`bordered` integer,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("__new_mini_app"."status" IN ('enabled', 'disabled', 'pinned'))
);--> statement-breakpoint
INSERT INTO `__new_mini_app`("app_id", "preset_miniapp_id", "name", "url", "logo", "status", "order_key", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at")
SELECT
  "app_id",
  CASE WHEN "kind" = 'default' THEN "app_id" ELSE NULL END,
  CASE WHEN "kind" = 'default' THEN NULL ELSE "name" END,
  CASE WHEN "kind" = 'default' THEN NULL ELSE "url" END,
  CASE WHEN "kind" = 'default' THEN NULL ELSE "logo" END,
  "status",
  "order_key",
  CASE WHEN "kind" = 'default' THEN NULL ELSE "bordered" END,
  CASE WHEN "kind" = 'default' THEN NULL ELSE "background" END,
  CASE WHEN "kind" = 'default' THEN NULL ELSE "supported_regions" END,
  "configuration",
  CASE WHEN "kind" = 'default' THEN NULL ELSE "name_key" END,
  "created_at",
  "updated_at"
FROM `mini_app`;--> statement-breakpoint
DROP TABLE `mini_app`;--> statement-breakpoint
ALTER TABLE `__new_mini_app` RENAME TO `mini_app`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mini_app_status_order_key_idx` ON `mini_app` (`status`,`order_key`);--> statement-breakpoint
CREATE INDEX `mini_app_preset_miniapp_id_idx` ON `mini_app` (`preset_miniapp_id`);

CREATE TABLE `mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`preset_mini_app_id` text,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`status` text DEFAULT 'enabled' NOT NULL,
	`order_key` text NOT NULL,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("mini_app"."status" IN ('enabled', 'disabled', 'pinned'))
);
--> statement-breakpoint
CREATE INDEX `mini_app_status_order_key_idx` ON `mini_app` (`status`,`order_key`);--> statement-breakpoint
CREATE INDEX `mini_app_preset_mini_app_id_idx` ON `mini_app` (`preset_mini_app_id`);--> statement-breakpoint
DROP TABLE `miniapp`;
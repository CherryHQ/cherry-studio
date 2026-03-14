CREATE TABLE `miniapp` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`app_id` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`type` text DEFAULT 'default' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`sort_order` integer DEFAULT 0,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`added_at` integer,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `miniapp_status_sort_idx` ON `miniapp` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `miniapp_app_id_idx` ON `miniapp` (`app_id`);--> statement-breakpoint
CREATE INDEX `miniapp_type_idx` ON `miniapp` (`type`);--> statement-breakpoint
CREATE INDEX `miniapp_pinned_idx` ON `miniapp` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `miniapp_status_type_idx` ON `miniapp` (`status`,`type`);
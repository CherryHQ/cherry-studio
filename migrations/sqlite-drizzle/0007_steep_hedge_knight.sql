CREATE TABLE `miniapp` (
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
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `miniapp_status_sort_idx` ON `miniapp` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `miniapp_type_idx` ON `miniapp` (`type`);--> statement-breakpoint
CREATE INDEX `miniapp_status_type_idx` ON `miniapp` (`status`,`type`);
CREATE TABLE `notification_record` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`dismissed_at` integer,
	`target` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_record_event_key_idx` ON `notification_record` (`event_key`);--> statement-breakpoint
CREATE INDEX `notification_record_time_idx` ON `notification_record` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notification_record_category_time_idx` ON `notification_record` (`category`,`created_at`,`id`);
CREATE TABLE `download_segment` (
	`task_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`task_id`, `idx`),
	FOREIGN KEY (`task_id`) REFERENCES `download_task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_task` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`final_url` text,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`temp_path` text NOT NULL,
	`mime` text,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`last_modified` text,
	`partition` text DEFAULT '' NOT NULL,
	`supports_ranges` integer DEFAULT true NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`connections` integer DEFAULT 8 NOT NULL,
	`source` text DEFAULT 'browser' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `download_task_state_created_idx` ON `download_task` (`state`,`created_at`);
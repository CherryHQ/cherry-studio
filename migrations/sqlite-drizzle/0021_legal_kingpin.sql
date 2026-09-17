CREATE TABLE `video` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`prompt` text NOT NULL,
	`duration` integer,
	`resolution` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_task_id` text,
	`video_url` text,
	`error_message` text,
	`job_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "video_status_check" CHECK("video"."status" IN ('pending','processing','completed','failed'))
);
--> statement-breakpoint
CREATE INDEX `video_status_idx` ON `video` (`status`);--> statement-breakpoint
CREATE INDEX `video_created_at_idx` ON `video` (`created_at`);
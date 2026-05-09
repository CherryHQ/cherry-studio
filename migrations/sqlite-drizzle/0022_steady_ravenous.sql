CREATE TABLE `painting` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`mode` text NOT NULL,
	`media_type` text NOT NULL,
	`prompt` text NOT NULL,
	`params` text NOT NULL,
	`files` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "painting_media_type_check" CHECK("painting"."media_type" IN ('image', 'video'))
);
--> statement-breakpoint
CREATE INDEX `painting_provider_mode_order_key_idx` ON `painting` (`provider_id`,`mode`,`order_key`);--> statement-breakpoint
CREATE INDEX `painting_provider_mode_created_idx` ON `painting` (`provider_id`,`mode`,`created_at`);

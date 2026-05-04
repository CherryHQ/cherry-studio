CREATE TABLE `painting` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`mode` text NOT NULL,
	`media_type` text DEFAULT 'image' NOT NULL,
	`model` text,
	`prompt` text DEFAULT '' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`files` text DEFAULT '{"output":[],"input":[]}' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "painting_mode_check" CHECK("painting"."mode" IN ('generate', 'draw', 'edit', 'remix', 'merge', 'upscale')),
	CONSTRAINT "painting_media_type_check" CHECK("painting"."media_type" IN ('image', 'video'))
);
--> statement-breakpoint
CREATE INDEX `painting_provider_mode_order_key_idx` ON `painting` (`provider_id`,`mode`,`order_key`);--> statement-breakpoint
CREATE INDEX `painting_provider_mode_created_idx` ON `painting` (`provider_id`,`mode`,`created_at`);

CREATE TABLE `painting` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`mode` text NOT NULL,
	`model` text,
	`prompt` text DEFAULT '' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`files` text DEFAULT '{"output":[],"input":[]}' NOT NULL,
	`parent_id` text,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `painting_provider_mode_order_key_idx` ON `painting` (`provider_id`,`mode`,`order_key`);--> statement-breakpoint
CREATE INDEX `painting_provider_mode_created_idx` ON `painting` (`provider_id`,`mode`,`created_at`);--> statement-breakpoint
CREATE INDEX `painting_parent_id_idx` ON `painting` (`parent_id`);

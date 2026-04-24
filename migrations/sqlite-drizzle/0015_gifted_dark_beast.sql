CREATE TABLE `prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`variables` text,
	FOREIGN KEY (`id`,`current_version`) REFERENCES `prompt_version`(`prompt_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prompt_order_key_idx` ON `prompt` (`order_key`);--> statement-breakpoint
CREATE INDEX `prompt_updated_at_idx` ON `prompt` (`updated_at`);--> statement-breakpoint
CREATE TABLE `prompt_version` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`rollback_from` integer,
	`variables` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_version_prompt_id_version_idx` ON `prompt_version` (`prompt_id`,`version`);

CREATE TABLE `prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_order_key_idx` ON `prompt` (`order_key`);--> statement-breakpoint
CREATE INDEX `prompt_updated_at_idx` ON `prompt` (`updated_at`);
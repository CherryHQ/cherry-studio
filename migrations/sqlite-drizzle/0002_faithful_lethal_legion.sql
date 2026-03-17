CREATE TABLE `prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `prompt_sort_order_idx` ON `prompt` (`sort_order`);--> statement-breakpoint
CREATE INDEX `prompt_updated_at_idx` ON `prompt` (`updated_at`);--> statement-breakpoint
CREATE TABLE `prompt_version` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_version_prompt_id_version_idx` ON `prompt_version` (`prompt_id`,`version`);
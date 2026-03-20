CREATE TABLE `assistant_prompt` (
	`assistant_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`assistant_id`, `prompt_id`),
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_prompt_assistant_id_idx` ON `assistant_prompt` (`assistant_id`);--> statement-breakpoint
CREATE TABLE `prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_sort_order_idx` ON `prompt` (`sort_order`);--> statement-breakpoint
CREATE INDEX `prompt_updated_at_idx` ON `prompt` (`updated_at`);--> statement-breakpoint
CREATE TABLE `prompt_version` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`rollback_from` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_version_prompt_id_version_idx` ON `prompt_version` (`prompt_id`,`version`);

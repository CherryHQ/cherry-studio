CREATE TABLE `translate_history` (
	`id` text PRIMARY KEY NOT NULL,
	`source_text` text NOT NULL,
	`target_text` text NOT NULL,
	`source_language` text NOT NULL,
	`target_language` text NOT NULL,
	`star` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `translate_history_created_at_idx` ON `translate_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `translate_history_star_created_at_idx` ON `translate_history` (`star`,`created_at`);--> statement-breakpoint
CREATE TABLE `translate_language` (
	`id` text PRIMARY KEY NOT NULL,
	`lang_code` text NOT NULL,
	`value` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translate_language_langCode_unique` ON `translate_language` (`lang_code`);
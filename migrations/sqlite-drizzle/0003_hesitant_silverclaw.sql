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
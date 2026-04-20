PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_translate_language` (
	`lang_code` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_translate_language`("lang_code", "value", "emoji", "created_at", "updated_at") SELECT "lang_code", "value", "emoji", "created_at", "updated_at" FROM `translate_language`;--> statement-breakpoint
DROP TABLE `translate_language`;--> statement-breakpoint
ALTER TABLE `__new_translate_language` RENAME TO `translate_language`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_translate_history` (
	`id` text PRIMARY KEY NOT NULL,
	`source_text` text NOT NULL,
	`target_text` text NOT NULL,
	`source_language` text,
	`target_language` text,
	`star` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`source_language`) REFERENCES `translate_language`(`lang_code`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_language`) REFERENCES `translate_language`(`lang_code`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_translate_history`("id", "source_text", "target_text", "source_language", "target_language", "star", "created_at", "updated_at") SELECT "id", "source_text", "target_text", "source_language", "target_language", "star", "created_at", "updated_at" FROM `translate_history`;--> statement-breakpoint
DROP TABLE `translate_history`;--> statement-breakpoint
ALTER TABLE `__new_translate_history` RENAME TO `translate_history`;--> statement-breakpoint
CREATE INDEX `translate_history_created_at_idx` ON `translate_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `translate_history_star_created_at_idx` ON `translate_history` (`star`,`created_at`);
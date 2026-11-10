CREATE TABLE `browser_visit` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`visited_at` integer NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`source_key` text
);
--> statement-breakpoint
CREATE INDEX `browser_visit_time_idx` ON `browser_visit` (`visited_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `browser_visit_source_key_idx` ON `browser_visit` (`source_key`);
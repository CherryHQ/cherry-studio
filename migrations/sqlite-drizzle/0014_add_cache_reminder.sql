PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `topic` ADD COLUMN `enable_cache_reminder` integer DEFAULT false;--> statement-breakpoint
PRAGMA foreign_keys=ON;
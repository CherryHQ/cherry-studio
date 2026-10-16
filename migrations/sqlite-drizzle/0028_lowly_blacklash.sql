ALTER TABLE `topic` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `topic_expires_at_idx` ON `topic` (`expires_at`);
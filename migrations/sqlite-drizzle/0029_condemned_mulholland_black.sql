ALTER TABLE `user_provider` ADD `alias` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_provider_alias_unique` ON `user_provider` (`alias`);
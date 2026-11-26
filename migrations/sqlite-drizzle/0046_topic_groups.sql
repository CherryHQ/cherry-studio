ALTER TABLE `topic` ADD `group_id` text REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `topic_group_id_idx` ON `topic` (`group_id`);
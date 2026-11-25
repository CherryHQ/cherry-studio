ALTER TABLE `topic` ADD `group_id` text REFERENCES group(id);--> statement-breakpoint
CREATE INDEX `topic_group_id_idx` ON `topic` (`group_id`);
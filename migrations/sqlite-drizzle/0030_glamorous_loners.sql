ALTER TABLE `agent` ADD `group_id` text REFERENCES `group`(`id`);--> statement-breakpoint
CREATE INDEX `agent_group_id_idx` ON `agent` (`group_id`);
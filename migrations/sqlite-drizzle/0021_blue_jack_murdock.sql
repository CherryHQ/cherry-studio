ALTER TABLE `agent` ADD `group_id` text REFERENCES `group`(`id`);

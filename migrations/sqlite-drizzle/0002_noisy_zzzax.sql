ALTER TABLE `message` RENAME COLUMN "response_group_id" TO "siblings_group_id";--> statement-breakpoint
ALTER TABLE `topic` ADD `active_node_id` text REFERENCES message(id);
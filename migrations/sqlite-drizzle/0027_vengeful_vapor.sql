ALTER TABLE `api_gateway_paired_device` ADD `assistant_grant_id` text;--> statement-breakpoint
ALTER TABLE `remote_command` ADD `topic_id` text;--> statement-breakpoint
ALTER TABLE `topic` ADD `remote_history_revision` integer DEFAULT 0 NOT NULL;
CREATE TABLE `remote_command` (
	`device_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`command_id` text NOT NULL,
	`method` text NOT NULL,
	`identity_digest` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`execution_id` text,
	`result` text,
	`error` text,
	`admitted_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `grant_id`, `command_id`),
	FOREIGN KEY (`device_id`) REFERENCES `api_gateway_paired_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `api_gateway_paired_device_token_hash_unique_idx`;--> statement-breakpoint
ALTER TABLE `api_gateway_paired_device` ADD `peer_identity` text;--> statement-breakpoint
ALTER TABLE `api_gateway_paired_device` ADD `configuration_grant_id` text;--> statement-breakpoint
ALTER TABLE `api_gateway_paired_device` ADD `agent_grant_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `api_gateway_paired_device_peer_identity_unique_idx` ON `api_gateway_paired_device` (`peer_identity`);--> statement-breakpoint
ALTER TABLE `api_gateway_paired_device` DROP COLUMN `token_hash`;
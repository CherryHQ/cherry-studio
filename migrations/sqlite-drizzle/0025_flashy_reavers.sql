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
	PRIMARY KEY(`device_id`, `grant_id`, `command_id`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_gateway_paired_device` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text,
	`peer_identity` text,
	`configuration_grant_id` text,
	`agent_grant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_api_gateway_paired_device`("id", "name", "platform", "token_hash", "peer_identity", "configuration_grant_id", "agent_grant_id", "created_at", "updated_at") SELECT "id", "name", "platform", "token_hash", NULL, NULL, NULL, "created_at", "updated_at" FROM `api_gateway_paired_device`;--> statement-breakpoint
DROP TABLE `api_gateway_paired_device`;--> statement-breakpoint
ALTER TABLE `__new_api_gateway_paired_device` RENAME TO `api_gateway_paired_device`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_gateway_paired_device_token_hash_unique_idx` ON `api_gateway_paired_device` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_gateway_paired_device_peer_identity_unique_idx` ON `api_gateway_paired_device` (`peer_identity`);
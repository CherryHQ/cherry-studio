CREATE TABLE `api_gateway_paired_device` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_gateway_paired_device_token_hash_unique_idx` ON `api_gateway_paired_device` (`token_hash`);
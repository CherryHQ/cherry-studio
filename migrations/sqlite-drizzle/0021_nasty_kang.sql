CREATE TABLE `cherry_account_session` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_token` text NOT NULL,
	`session_id` text NOT NULL,
	`session_expires_at` integer NOT NULL,
	`device_id` text NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text,
	`device_public_key` text NOT NULL,
	`device_private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `remote_command` (
	`device_id` text NOT NULL,
	`command_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`agent_id` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `command_id`),
	FOREIGN KEY (`device_id`) REFERENCES `api_gateway_paired_device`(`id`) ON UPDATE no action ON DELETE cascade
);

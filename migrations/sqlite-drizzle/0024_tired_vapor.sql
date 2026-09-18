CREATE TABLE `remote_command` (
	`device_id` text NOT NULL,
	`command_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`agent_id` text NOT NULL,
	`session_id` text,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `command_id`)
);

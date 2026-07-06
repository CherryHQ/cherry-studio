CREATE TABLE `agent_session_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`context_usage` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);

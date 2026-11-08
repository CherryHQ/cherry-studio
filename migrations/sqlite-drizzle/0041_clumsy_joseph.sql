CREATE TABLE `agent_session_tool_output` (
	`message_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`session_id` text NOT NULL,
	`revision` text NOT NULL,
	`output` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `tool_call_id`),
	FOREIGN KEY (`message_id`) REFERENCES `agent_session_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_session_tool_output_session_idx` ON `agent_session_tool_output` (`session_id`);
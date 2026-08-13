CREATE TABLE `agent_channel_conversation` (
	`channel_id` text NOT NULL,
	`conversation_key` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`channel_id`, `conversation_key`),
	FOREIGN KEY (`channel_id`) REFERENCES `agent_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_channel_conversation_session_id_idx` ON `agent_channel_conversation` (`session_id`);
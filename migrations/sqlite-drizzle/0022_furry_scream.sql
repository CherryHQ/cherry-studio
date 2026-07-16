CREATE TABLE `agent_session_runtime_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`runtime_type` text NOT NULL,
	`version` integer NOT NULL,
	`compacted_through_message_id` text NOT NULL,
	`summary` text NOT NULL,
	`summary_token_count` integer,
	`source_token_count` integer,
	`compaction_model_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`compacted_through_message_id`) REFERENCES `agent_session_message`(`id`) ON UPDATE no action ON DELETE cascade
);

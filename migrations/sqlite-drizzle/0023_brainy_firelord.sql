CREATE TABLE `agent_session_edit` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`committed_at` integer,
	`document` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_session_edit_session` ON `agent_session_edit` (`session_id`,`committed_at`);
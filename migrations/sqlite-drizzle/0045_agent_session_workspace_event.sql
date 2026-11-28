CREATE TABLE `agent_session_workspace_event` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`previous_workspace_id` text NOT NULL,
	`previous_workspace_path` text NOT NULL,
	`new_workspace_id` text NOT NULL,
	`new_workspace_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`surfaced_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_session_workspace_event_session_idx` ON `agent_session_workspace_event` (`session_id`,`created_at`);
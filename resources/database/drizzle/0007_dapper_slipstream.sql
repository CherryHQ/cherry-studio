ALTER TABLE `scheduled_tasks` ADD `timeout_minutes` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_logs` ADD `session_id` text;
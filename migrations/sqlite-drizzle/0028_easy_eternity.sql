CREATE TABLE `agent_task_run` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`run_id` text NOT NULL,
	`task_id` text,
	`session_id` text,
	`agent_id` text,
	`name_snapshot` text NOT NULL,
	`agent_name_snapshot` text NOT NULL,
	`message_anchor` text,
	`started_at` integer,
	`ended_at` integer,
	`last_activity_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`blocked_on` text,
	`reason_code` text,
	`error_summary` text,
	`viewed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `job_schedule`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_task_run_status_check" CHECK("agent_task_run"."status" IN ('queued','running','succeeded','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_run_source_run_idx` ON `agent_task_run` (`source`,`run_id`);--> statement-breakpoint
CREATE INDEX `agent_task_run_awaiting_idx` ON `agent_task_run` (`ended_at`,`id`) WHERE "agent_task_run"."viewed_at" IS NULL AND "agent_task_run"."ended_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_task_run_session_idx` ON `agent_task_run` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_task_run_task_idx` ON `agent_task_run` (`task_id`);--> statement-breakpoint
CREATE INDEX `agent_task_run_status_idx` ON `agent_task_run` (`status`);
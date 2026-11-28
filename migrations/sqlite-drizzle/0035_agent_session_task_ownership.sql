PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_session` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_session_id` text,
	`type` text DEFAULT 'conversation' NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`is_name_manually_edited` integer DEFAULT false NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text,
	`is_task_reuse_target` integer DEFAULT false NOT NULL,
	`trace_id` text,
	`active_node_id` text,
	`order_key` text NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `agent_workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `job_schedule`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_session_task_reuse_owner_check" CHECK("__new_agent_session"."is_task_reuse_target" = 0 OR "__new_agent_session"."task_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_agent_session`("id", "owner_session_id", "type", "agent_id", "name", "is_name_manually_edited", "description", "workspace_id", "task_id", "is_task_reuse_target", "trace_id", "active_node_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at") SELECT "id", "owner_session_id", "type", "agent_id", "name", "is_name_manually_edited", "description", "workspace_id", coalesce("task_schedule_id", (
  SELECT job.schedule_id FROM job
  JOIN job_schedule ON job_schedule.id = job.schedule_id
  WHERE job.type = 'agent.task'
    AND coalesce(json_extract(job.metadata, '$.sessionId'), json_extract(job.output, '$.sessionId')) = agent_session.id
  ORDER BY job.created_at DESC, job.id DESC LIMIT 1
)), "task_schedule_id" IS NOT NULL, "trace_id", "active_node_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at" FROM `agent_session`;--> statement-breakpoint
DROP TABLE `agent_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_session` RENAME TO `agent_session`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_session_order_key_idx` ON `agent_session` (`order_key`);--> statement-breakpoint
CREATE INDEX `agent_session_task_idx` ON `agent_session` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_task_reuse_uq` ON `agent_session` (`task_id`) WHERE "agent_session"."is_task_reuse_target" = 1;--> statement-breakpoint
CREATE INDEX `agent_session_owner_idx` ON `agent_session` (`owner_session_id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_idx` ON `agent_session` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_idx` ON `agent_session` (`updated_at`);
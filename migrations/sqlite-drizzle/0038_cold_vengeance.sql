ALTER TABLE `agent_session` ADD `task_schedule_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_taskScheduleId_unique` ON `agent_session` (`task_schedule_id`);--> statement-breakpoint
UPDATE agent_session
SET task_schedule_id = CASE WHEN is_task_reuse_target = 1 THEN task_id ELSE NULL END;

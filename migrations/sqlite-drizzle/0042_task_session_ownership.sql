ALTER TABLE `agent_session` ADD `is_task_owned` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Prior rows do not distinguish picked conversations from task-created history.
-- Preserve uncertain history rather than giving task deletion ownership over it.
UPDATE agent_session SET task_id = NULL WHERE is_task_reuse_target = 0;

ALTER TABLE `agent_session` ADD `is_task_owned` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Preserve historical associations independently of deletion ownership.
-- Before explicit selection existed, linked conversations were task-created.
UPDATE agent_session SET is_task_owned = 1
WHERE task_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM job_schedule WHERE job_schedule.id = agent_session.task_id
    AND CASE WHEN json_valid(job_schedule.metadata)
      THEN coalesce(json_extract(job_schedule.metadata, '$.reuse.boundKind'), '') != 'explicit'
      ELSE 0 END
);

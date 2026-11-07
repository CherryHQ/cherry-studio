ALTER TABLE `agent_session` ADD `source_task_schedule_id` text REFERENCES job_schedule(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `agent_session_source_task_idx` ON `agent_session` (`source_task_schedule_id`);
--> statement-breakpoint
UPDATE agent_session
SET source_task_schedule_id = coalesce(task_schedule_id, (
  SELECT job.schedule_id FROM job
  JOIN job_schedule ON job_schedule.id = job.schedule_id
  WHERE job.type = 'agent.task'
    AND coalesce(json_extract(job.metadata, '$.sessionId'), json_extract(job.output, '$.sessionId')) = agent_session.id
  ORDER BY job.created_at DESC, job.id DESC LIMIT 1
));

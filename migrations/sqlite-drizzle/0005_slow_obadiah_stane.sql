ALTER TABLE `agent_session` ADD `task_schedule_id` text REFERENCES job_schedule(id) ON DELETE SET NULL;--> statement-breakpoint
WITH candidates AS (
  SELECT
    schedule.id AS schedule_id,
    json_extract(
      CASE WHEN json_valid(schedule.metadata) THEN schedule.metadata END,
      '$.reuse.sessionId'
    ) AS session_id,
    ROW_NUMBER() OVER (
      PARTITION BY json_extract(
        CASE WHEN json_valid(schedule.metadata) THEN schedule.metadata END,
        '$.reuse.sessionId'
      )
      ORDER BY schedule.updated_at DESC, schedule.id ASC
    ) AS position
  FROM job_schedule AS schedule
  INNER JOIN agent_session AS session
    ON session.id = json_extract(
      CASE WHEN json_valid(schedule.metadata) THEN schedule.metadata END,
      '$.reuse.sessionId'
    )
    AND session.agent_id = json_extract(
      CASE WHEN json_valid(schedule.job_input_template) THEN schedule.job_input_template END,
      '$.agentId'
    )
  WHERE schedule.type = 'agent.task'
    AND json_type(
      CASE WHEN json_valid(schedule.metadata) THEN schedule.metadata END,
      '$.reuse.enabled'
    ) = 'true'
    AND json_type(
      CASE WHEN json_valid(schedule.metadata) THEN schedule.metadata END,
      '$.reuse.sessionId'
    ) = 'text'
)
UPDATE agent_session
SET task_schedule_id = (
  SELECT schedule_id FROM candidates
  WHERE candidates.session_id = agent_session.id AND candidates.position = 1
)
WHERE id IN (SELECT session_id FROM candidates WHERE position = 1);--> statement-breakpoint
UPDATE job_schedule
SET metadata = json_remove(metadata, '$.reuse.sessionId')
WHERE type = 'agent.task'
  AND json_type(CASE WHEN json_valid(metadata) THEN metadata END, '$.reuse') = 'object';--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_taskScheduleId_unique` ON `agent_session` (`task_schedule_id`);

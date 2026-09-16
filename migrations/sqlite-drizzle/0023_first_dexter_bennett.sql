ALTER TABLE `agent_session` ADD `type` text DEFAULT 'conversation' NOT NULL;
--> statement-breakpoint
UPDATE `agent_session`
SET `type` = 'background'
WHERE `id` IN (
  SELECT json_extract(`job`.`metadata`, '$.sessionId')
  FROM `job`
  JOIN `job_schedule` ON `job_schedule`.`id` = `job`.`schedule_id`
  WHERE `job`.`type` = 'agent.task'
    AND json_extract(`job`.`input`, '$.prompt') = '__heartbeat__'
    AND json_extract(`job_schedule`.`job_input_template`, '$.prompt') = '__heartbeat__'
)
AND NOT EXISTS (
  SELECT 1 FROM `job`
  WHERE json_extract(`metadata`, '$.sessionId') = `agent_session`.`id`
    AND (`type` != 'agent.task' OR json_extract(`input`, '$.prompt') IS NOT '__heartbeat__')
);

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
    -- Only the two names sync mints: `heartbeat_<agentId>` and its disambiguated
    -- `heartbeat_<agentId>__<suffix>` (see `reservedNameShape` in the deletion
    -- sweep). A user-authored schedule that merely shares the prefix stays visible.
    AND (
      `job_schedule`.`name` = 'heartbeat_' || json_extract(`job_schedule`.`job_input_template`, '$.agentId')
      OR substr(
        `job_schedule`.`name`,
        1,
        length('heartbeat_') + length(json_extract(`job_schedule`.`job_input_template`, '$.agentId')) + 2
      ) = 'heartbeat_' || json_extract(`job_schedule`.`job_input_template`, '$.agentId') || '__'
    )
)
AND NOT EXISTS (
  SELECT 1 FROM `job`
  WHERE json_extract(`metadata`, '$.sessionId') = `agent_session`.`id`
    AND (`type` != 'agent.task' OR json_extract(`input`, '$.prompt') IS NOT '__heartbeat__')
);

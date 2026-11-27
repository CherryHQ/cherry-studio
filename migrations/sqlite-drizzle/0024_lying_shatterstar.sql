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
    -- Only the two names sync mints: `heartbeat_<agentId>`, and the create-race
    -- disambiguation `heartbeat_<agentId>__<8 lowercase hex>` (randomUUID().slice(0, 8),
    -- see syncHeartbeatSchedule). Any other name under the `heartbeat_<agentId>__`
    -- prefix — including one a user typed, like `heartbeat_<agentId>__user` —
    -- stays visible; a heartbeat row that is missed renders as a conversation,
    -- which is cosmetic, while hiding a user conversation is not.
    AND (
      `job_schedule`.`name` = 'heartbeat_' || json_extract(`job_schedule`.`job_input_template`, '$.agentId')
      OR (
        substr(
          `job_schedule`.`name`,
          1,
          length('heartbeat_') + length(json_extract(`job_schedule`.`job_input_template`, '$.agentId')) + 2
        ) = 'heartbeat_' || json_extract(`job_schedule`.`job_input_template`, '$.agentId') || '__'
        AND substr(
          `job_schedule`.`name`,
          length('heartbeat_') + length(json_extract(`job_schedule`.`job_input_template`, '$.agentId')) + 3
        ) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      )
    )
)
AND NOT EXISTS (
  SELECT 1 FROM `job`
  WHERE json_extract(`metadata`, '$.sessionId') = `agent_session`.`id`
    AND (`type` != 'agent.task' OR json_extract(`input`, '$.prompt') IS NOT '__heartbeat__')
);

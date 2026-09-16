ALTER TABLE `agent_session` ADD `type` text DEFAULT 'conversation' NOT NULL;
--> statement-breakpoint
UPDATE `agent_session`
SET `type` = 'background'
WHERE `id` IN (
  SELECT json_extract(`metadata`, '$.sessionId') FROM `job`
  WHERE `type` = 'agent.task'
    AND json_extract(`input`, '$.prompt') = '__heartbeat__'
)
AND NOT EXISTS (
  SELECT 1 FROM `job`
  WHERE json_extract(`metadata`, '$.sessionId') = `agent_session`.`id`
    AND (`type` != 'agent.task' OR json_extract(`input`, '$.prompt') IS NOT '__heartbeat__')
);

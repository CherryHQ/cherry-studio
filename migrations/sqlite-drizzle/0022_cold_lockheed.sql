ALTER TABLE `agent_session` ADD `agent_type` text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
UPDATE `agent_session`
SET `agent_type` = COALESCE(
  (
    SELECT CASE WHEN `agent`.`type` = 'cherry-claw' THEN 'claude-code' ELSE `agent`.`type` END
    FROM `agent`
    WHERE `agent`.`id` = `agent_session`.`agent_id`
  ),
  'claude-code'
);

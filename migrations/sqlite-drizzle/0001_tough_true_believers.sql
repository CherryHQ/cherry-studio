ALTER TABLE `agent_session` ADD `model_id` text REFERENCES user_model(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `agent_session`
SET `model_id` = (
  SELECT `agent`.`model`
  FROM `agent`
  WHERE `agent`.`id` = `agent_session`.`agent_id`
);

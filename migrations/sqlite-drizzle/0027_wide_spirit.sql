ALTER TABLE `agent_session` ADD `model_id` text REFERENCES user_model(id);--> statement-breakpoint
CREATE INDEX `agent_session_model_id_idx` ON `agent_session` (`model_id`);
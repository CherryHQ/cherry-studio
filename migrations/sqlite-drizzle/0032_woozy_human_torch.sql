ALTER TABLE `agent_session` ADD `owner_session_id` text REFERENCES agent_session(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `agent_session_owner_idx` ON `agent_session` (`owner_session_id`);--> statement-breakpoint
ALTER TABLE `agent_session_context` ADD `parent_context_id` text REFERENCES agent_session_context(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `agent_session_context` ADD `subagent_id` text;--> statement-breakpoint
ALTER TABLE `agent_session_context` ADD `spawn_tool_call_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_context_child_uniq` ON `agent_session_context` (`parent_context_id`,`subagent_id`);
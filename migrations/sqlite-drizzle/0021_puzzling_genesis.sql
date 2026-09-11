ALTER TABLE `agent_session` ADD `forked_from` text;--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `runtime_fork_state` text;
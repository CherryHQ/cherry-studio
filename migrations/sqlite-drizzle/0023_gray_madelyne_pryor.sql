DROP INDEX `agent_session_updated_at_idx`;--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
DROP INDEX `topic_updated_at_idx`;--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);
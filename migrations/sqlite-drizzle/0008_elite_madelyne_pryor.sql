DROP INDEX `agent_session_last_activity_at_idx`;--> statement-breakpoint
DROP INDEX `agent_session_updated_at_idx`;--> statement-breakpoint
CREATE INDEX `agent_session_created_at_id_idx` ON `agent_session` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_id_idx` ON `agent_session` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_agent_id_last_activity_at_id_idx` ON `agent_session` (`agent_id`,"last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
DROP INDEX `topic_last_activity_at_idx`;--> statement-breakpoint
DROP INDEX `topic_updated_at_idx`;--> statement-breakpoint
CREATE INDEX `topic_created_at_id_idx` ON `topic` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_last_activity_at_id_idx` ON `topic` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_created_at_id_idx` ON `topic` (`assistant_id`,"created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_last_activity_at_id_idx` ON `topic` (`assistant_id`,"last_activity_at" desc,`id`);
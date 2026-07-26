DROP INDEX `agent_session_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `last_activity_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_session_created_at_id_idx` ON `agent_session` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_id_idx` ON `agent_session` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
DROP INDEX `topic_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `topic` ADD `last_activity_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `topic_created_at_id_idx` ON `topic` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_last_activity_at_id_idx` ON `topic` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_created_at_id_idx` ON `topic` (`assistant_id`,"created_at" desc,`id`);--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `terminal_at` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `terminal_at` integer;
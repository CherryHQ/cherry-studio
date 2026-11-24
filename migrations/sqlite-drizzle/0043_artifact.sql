-- Earlier unreleased builds of this stack created `artifact` in other shapes (with `assistant_id`, or inside 0042).
-- Create it when missing, then rebuild it into the current shape so every such profile, and a fresh one, ends up equal.
CREATE TABLE IF NOT EXISTS `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`session_id` text,
	`topic_id` text,
	`path` text,
	`file_entry_id` text,
	`title` text NOT NULL,
	`size` integer,
	`reported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `__new_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`session_id` text,
	`topic_id` text,
	`path` text,
	`file_entry_id` text,
	`title` text NOT NULL,
	`size` integer,
	`reported_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_owner_check" CHECK(("__new_artifact"."agent_id" IS NOT NULL AND "__new_artifact"."session_id" IS NOT NULL AND "__new_artifact"."topic_id" IS NULL AND "__new_artifact"."path" IS NOT NULL AND "__new_artifact"."file_entry_id" IS NULL) OR ("__new_artifact"."agent_id" IS NULL AND "__new_artifact"."session_id" IS NULL AND "__new_artifact"."topic_id" IS NOT NULL AND "__new_artifact"."path" IS NULL AND "__new_artifact"."file_entry_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_artifact`(`id`, `agent_id`, `session_id`, `topic_id`, `path`, `file_entry_id`, `title`, `size`, `reported_at`) SELECT `id`, `agent_id`, `session_id`, `topic_id`, `path`, `file_entry_id`, `title`, `size`, `reported_at` FROM `artifact`;--> statement-breakpoint
DROP TABLE `artifact`;--> statement-breakpoint
ALTER TABLE `__new_artifact` RENAME TO `artifact`;--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_session_path_uq` ON `artifact` (`session_id`,`path`);--> statement-breakpoint
CREATE INDEX `artifact_agent_reported_idx` ON `artifact` (`agent_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `artifact_topic_idx` ON `artifact` (`topic_id`);--> statement-breakpoint
CREATE INDEX `artifact_file_entry_idx` ON `artifact` (`file_entry_id`);

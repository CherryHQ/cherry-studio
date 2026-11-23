CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`session_id` text,
	`assistant_id` text,
	`topic_id` text,
	`path` text,
	`file_entry_id` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer,
	`reported_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_kind_check" CHECK("artifact"."kind" IN ('page', 'media', 'file')),
	CONSTRAINT "artifact_owner_check" CHECK(("artifact"."agent_id" IS NOT NULL AND "artifact"."session_id" IS NOT NULL AND "artifact"."assistant_id" IS NULL AND "artifact"."topic_id" IS NULL AND "artifact"."path" IS NOT NULL AND "artifact"."file_entry_id" IS NULL) OR ("artifact"."agent_id" IS NULL AND "artifact"."session_id" IS NULL AND "artifact"."assistant_id" IS NOT NULL AND "artifact"."topic_id" IS NOT NULL AND "artifact"."path" IS NULL AND "artifact"."file_entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_session_path_uq` ON `artifact` (`session_id`,`path`);--> statement-breakpoint
CREATE INDEX `artifact_agent_reported_idx` ON `artifact` (`agent_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `artifact_assistant_reported_idx` ON `artifact` (`assistant_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `artifact_topic_idx` ON `artifact` (`topic_id`);--> statement-breakpoint
CREATE INDEX `artifact_file_entry_idx` ON `artifact` (`file_entry_id`);
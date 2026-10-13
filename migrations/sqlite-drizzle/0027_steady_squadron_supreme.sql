CREATE TABLE `agent_workspace_copy` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_digest` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`source_workspace_id` text,
	`source_path` text NOT NULL,
	`source_identity` text NOT NULL,
	`source_copy_id` text,
	`consumer` text NOT NULL,
	`fork_operation_id` text,
	`intended_session_id` text,
	`reserved_workspace_id` text NOT NULL,
	`target_workspace_id` text,
	`name` text NOT NULL,
	`location` text NOT NULL,
	`ownership_token` text NOT NULL,
	`ownership` text,
	`state` text DEFAULT 'creating' NOT NULL,
	`cleanup` text DEFAULT 'none' NOT NULL,
	`cleanup_reason` text,
	`error_code` text,
	`policy_version` integer DEFAULT 1 NOT NULL,
	`statistics` text,
	`storage_fallback` text,
	`prepared_at` integer,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_workspace_id`) REFERENCES `agent_workspace`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_workspace_id`) REFERENCES `agent_workspace`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_workspace_copy_state_check" CHECK("agent_workspace_copy"."state" IN ('creating', 'prepared', 'ready', 'failed', 'cancelled', 'deleting', 'removed')),
	CONSTRAINT "agent_workspace_copy_cleanup_check" CHECK("agent_workspace_copy"."cleanup" IN ('none', 'pending', 'blocked')),
	CONSTRAINT "agent_workspace_copy_consumer_check" CHECK("agent_workspace_copy"."consumer" IN ('standalone', 'session-fork'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_workspace_copy_request_unique_idx` ON `agent_workspace_copy` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_workspace_copy_target_unique_idx` ON `agent_workspace_copy` (`target_workspace_id`);--> statement-breakpoint
CREATE INDEX `agent_workspace_copy_source_idx` ON `agent_workspace_copy` (`source_workspace_id`);--> statement-breakpoint
CREATE INDEX `agent_workspace_copy_state_idx` ON `agent_workspace_copy` (`state`,`cleanup`);
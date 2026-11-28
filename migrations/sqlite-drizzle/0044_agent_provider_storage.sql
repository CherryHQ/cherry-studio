CREATE TABLE `agent_provider_binding` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`browser_control` text,
	`model` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_provider`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agent_provider_binding_provider_idx` ON `agent_provider_binding` (`provider_id`);--> statement-breakpoint
CREATE TABLE `agent_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`preset_id` text,
	`executable` text,
	`args` text,
	`env` text,
	`encrypted_env` text,
	`account` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "agent_provider_launch_target_check" CHECK("agent_provider"."preset_id" IS NOT NULL OR "agent_provider"."executable" IS NOT NULL)
);
--> statement-breakpoint
DROP INDEX `agent_runtime_backend_locator_uniq`;--> statement-breakpoint
ALTER TABLE `agent_runtime_backend` ADD `local_provider_id` text REFERENCES agent_provider(id);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_backend_provider_uniq` ON `agent_runtime_backend` (`local_provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_backend_locator_uniq` ON `agent_runtime_backend` (`locator`) WHERE json_extract("agent_runtime_backend"."locator", '$.kind') <> 'local';--> statement-breakpoint
ALTER TABLE `agent_session_context` ADD `local_model` text;
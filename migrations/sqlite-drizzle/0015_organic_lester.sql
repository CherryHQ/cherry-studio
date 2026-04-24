PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accessible_paths` text,
	`instructions` text,
	`model` text,
	`plan_model` text,
	`small_model` text,
	`mcps` text,
	`allowed_tools` text,
	`configuration` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`small_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Remap legacy `providerId:modelId` strings to `user_model.id` so the new
-- FK on agent.{model,plan_model,small_model} holds. Unresolvable values
-- become NULL (the FK with ON DELETE SET NULL accepts NULL). Same lookup
-- shape as resolveUserModelId in the runtime write path and as
-- buildUserModelLookupExpr in AgentsDbMappings.
INSERT INTO `__new_agent`("id", "type", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "configuration", "sort_order", "created_at", "updated_at", "deleted_at") SELECT
  "id", "type", "name", "description", "accessible_paths", "instructions",
  (SELECT user_model.id FROM user_model WHERE user_model.id = agent.model OR (user_model.provider_id || ':' || user_model.model_id) = agent.model LIMIT 1) AS "model",
  (SELECT user_model.id FROM user_model WHERE user_model.id = agent.plan_model OR (user_model.provider_id || ':' || user_model.model_id) = agent.plan_model LIMIT 1) AS "plan_model",
  (SELECT user_model.id FROM user_model WHERE user_model.id = agent.small_model OR (user_model.provider_id || ':' || user_model.model_id) = agent.small_model LIMIT 1) AS "small_model",
  "mcps", "allowed_tools", "configuration", "sort_order", "created_at", "updated_at", "deleted_at"
FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_name_idx` ON `agent` (`name`);--> statement-breakpoint
CREATE INDEX `agent_type_idx` ON `agent` (`type`);--> statement-breakpoint
CREATE INDEX `agent_sort_order_idx` ON `agent` (`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_agent_session` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_type` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accessible_paths` text,
	`instructions` text,
	`model` text,
	`plan_model` text,
	`small_model` text,
	`mcps` text,
	`allowed_tools` text,
	`slash_commands` text,
	`configuration` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`small_model`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Same legacy-model remap as on agent above.
INSERT INTO `__new_agent_session`("id", "agent_type", "agent_id", "name", "description", "accessible_paths", "instructions", "model", "plan_model", "small_model", "mcps", "allowed_tools", "slash_commands", "configuration", "sort_order", "created_at", "updated_at") SELECT
  "id", "agent_type", "agent_id", "name", "description", "accessible_paths", "instructions",
  (SELECT user_model.id FROM user_model WHERE user_model.id = agent_session.model OR (user_model.provider_id || ':' || user_model.model_id) = agent_session.model LIMIT 1) AS "model",
  (SELECT user_model.id FROM user_model WHERE user_model.id = agent_session.plan_model OR (user_model.provider_id || ':' || user_model.model_id) = agent_session.plan_model LIMIT 1) AS "plan_model",
  (SELECT user_model.id FROM user_model WHERE user_model.id = agent_session.small_model OR (user_model.provider_id || ':' || user_model.model_id) = agent_session.small_model LIMIT 1) AS "small_model",
  "mcps", "allowed_tools", "slash_commands", "configuration", "sort_order", "created_at", "updated_at"
FROM `agent_session`;--> statement-breakpoint
DROP TABLE `agent_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_session` RENAME TO `agent_session`;--> statement-breakpoint
CREATE INDEX `agent_session_agent_id_idx` ON `agent_session` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_session_model_idx` ON `agent_session` (`model`);--> statement-breakpoint
CREATE INDEX `agent_session_sort_order_idx` ON `agent_session` (`sort_order`);
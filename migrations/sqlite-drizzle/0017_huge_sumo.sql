PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `mcp_server` ADD `server_wire_name` text;--> statement-breakpoint
UPDATE `mcp_server`
SET `server_wire_name` = cs_mcp_server_wire_name(`id`, `name`)
WHERE `server_wire_name` IS NULL OR length(trim(`server_wire_name`)) = 0;--> statement-breakpoint
UPDATE `agent`
SET `disabled_tools` = (
	SELECT json_group_array(`value`)
	FROM (
		SELECT DISTINCT cs_mcp_builtin_runtime_name(`value`) AS `value`
		FROM json_each(`agent`.`disabled_tools`)
		ORDER BY `value`
	)
)
WHERE json_valid(`disabled_tools`) AND json_type(`disabled_tools`) = 'array';--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_wire_name_backfill_unique` ON `mcp_server` (`server_wire_name`);--> statement-breakpoint
CREATE TABLE `__new_mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`server_wire_name` text NOT NULL,
	`type` text,
	`description` text,
	`base_url` text,
	`command` text,
	`registry_url` text,
	`args` text,
	`env` text,
	`headers` text,
	`provider` text,
	`provider_url` text,
	`logo_url` text,
	`tags` text,
	`long_running` integer,
	`timeout` integer,
	`dxt_version` text,
	`dxt_path` text,
	`reference` text,
	`search_key` text,
	`config_sample` text,
	`disabled_tools` text,
	`disabled_auto_approve_tools` text,
	`should_config` integer,
	`sort_order` integer DEFAULT 0,
	`is_active` integer DEFAULT false NOT NULL,
	`install_source` text,
	`is_trusted` integer,
	`trusted_at` integer,
	`installed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mcp_server_type_check" CHECK("__new_mcp_server"."type" IS NULL OR "__new_mcp_server"."type" IN ('stdio', 'sse', 'streamableHttp', 'inMemory')),
	CONSTRAINT "mcp_server_install_source_check" CHECK("__new_mcp_server"."install_source" IS NULL OR "__new_mcp_server"."install_source" IN ('builtin', 'manual', 'ai_assisted', 'protocol', 'unknown')),
	CONSTRAINT "mcp_server_wire_name_nonempty_check" CHECK(length(trim("__new_mcp_server"."server_wire_name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_mcp_server`("id", "name", "server_wire_name", "type", "description", "base_url", "command", "registry_url", "args", "env", "headers", "provider", "provider_url", "logo_url", "tags", "long_running", "timeout", "dxt_version", "dxt_path", "reference", "search_key", "config_sample", "disabled_tools", "disabled_auto_approve_tools", "should_config", "sort_order", "is_active", "install_source", "is_trusted", "trusted_at", "installed_at", "created_at", "updated_at") SELECT "id", "name", "server_wire_name", "type", "description", "base_url", "command", "registry_url", "args", "env", "headers", "provider", "provider_url", "logo_url", "tags", "long_running", "timeout", "dxt_version", "dxt_path", "reference", "search_key", "config_sample", "disabled_tools", "disabled_auto_approve_tools", "should_config", "sort_order", "is_active", "install_source", "is_trusted", "trusted_at", "installed_at", "created_at", "updated_at" FROM `mcp_server`;--> statement-breakpoint
DROP TABLE `mcp_server`;--> statement-breakpoint
ALTER TABLE `__new_mcp_server` RENAME TO `mcp_server`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mcp_server_name_idx` ON `mcp_server` (`name`);--> statement-breakpoint
CREATE INDEX `mcp_server_wire_name_idx` ON `mcp_server` (`server_wire_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_wire_name_unique` ON `mcp_server` (`server_wire_name`);--> statement-breakpoint
CREATE INDEX `mcp_server_is_active_idx` ON `mcp_server` (`is_active`);--> statement-breakpoint
CREATE INDEX `mcp_server_sort_order_idx` ON `mcp_server` (`sort_order`);

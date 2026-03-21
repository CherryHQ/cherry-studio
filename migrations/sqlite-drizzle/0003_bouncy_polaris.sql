CREATE TABLE `miniapp` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`type` text DEFAULT 'default' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`sort_order` integer DEFAULT 0,
	`bordered` integer DEFAULT true,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `miniapp_status_sort_idx` ON `miniapp` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `miniapp_type_idx` ON `miniapp` (`type`);--> statement-breakpoint
CREATE INDEX `miniapp_status_type_idx` ON `miniapp` (`status`,`type`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
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
	`is_active` integer DEFAULT false NOT NULL,
	`install_source` text,
	`is_trusted` integer,
	`trusted_at` integer,
	`installed_at` integer,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "mcp_server_type_check" CHECK("__new_mcp_server"."type" IS NULL OR "__new_mcp_server"."type" IN ('stdio', 'sse', 'streamableHttp', 'inMemory')),
	CONSTRAINT "mcp_server_install_source_check" CHECK("__new_mcp_server"."install_source" IS NULL OR "__new_mcp_server"."install_source" IN ('builtin', 'manual', 'protocol', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_mcp_server`("id", "name", "type", "description", "base_url", "command", "registry_url", "args", "env", "headers", "provider", "provider_url", "logo_url", "tags", "long_running", "timeout", "dxt_version", "dxt_path", "reference", "search_key", "config_sample", "disabled_tools", "disabled_auto_approve_tools", "should_config", "is_active", "install_source", "is_trusted", "trusted_at", "installed_at", "created_at", "updated_at") SELECT "id", "name", "type", "description", "base_url", "command", "registry_url", "args", "env", "headers", "provider", "provider_url", "logo_url", "tags", "long_running", "timeout", "dxt_version", "dxt_path", "reference", "search_key", "config_sample", "disabled_tools", "disabled_auto_approve_tools", "should_config", "is_active", "install_source", "is_trusted", "trusted_at", "installed_at", "created_at", "updated_at" FROM `mcp_server`;--> statement-breakpoint
DROP TABLE `mcp_server`;--> statement-breakpoint
ALTER TABLE `__new_mcp_server` RENAME TO `mcp_server`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mcp_server_name_idx` ON `mcp_server` (`name`);--> statement-breakpoint
CREATE INDEX `mcp_server_is_active_idx` ON `mcp_server` (`is_active`);
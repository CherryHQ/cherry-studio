PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`preset_mini_app_id` text,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo` text,
	`status` text DEFAULT 'enabled' NOT NULL,
	`order_key` text NOT NULL,
	`bordered` integer DEFAULT true NOT NULL,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("__new_mini_app"."status" IN ('enabled', 'disabled', 'pinned'))
);
--> statement-breakpoint
INSERT INTO `__new_mini_app`("app_id", "preset_mini_app_id", "name", "url", "logo", "status", "order_key", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "preset_mini_app_id", "name", "url", "logo", "status", "order_key", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `mini_app`;--> statement-breakpoint
DROP TABLE `mini_app`;--> statement-breakpoint
ALTER TABLE `__new_mini_app` RENAME TO `mini_app`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mini_app_status_order_key_idx` ON `mini_app` (`status`,`order_key`);--> statement-breakpoint
CREATE INDEX `mini_app_preset_mini_app_id_idx` ON `mini_app` (`preset_mini_app_id`);--> statement-breakpoint
CREATE TABLE `__new_user_model` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`preset_model_id` text,
	`name` text,
	`description` text,
	`group` text,
	`capabilities` text,
	`input_modalities` text,
	`output_modalities` text,
	`endpoint_types` text,
	`custom_endpoint_url` text,
	`context_window` integer,
	`max_output_tokens` integer,
	`supports_streaming` integer,
	`reasoning` text,
	`parameters` text,
	`pricing` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`is_deprecated` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0,
	`notes` text,
	`user_overrides` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `user_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_model`("id", "provider_id", "model_id", "preset_model_id", "name", "description", "group", "capabilities", "input_modalities", "output_modalities", "endpoint_types", "custom_endpoint_url", "context_window", "max_output_tokens", "supports_streaming", "reasoning", "parameters", "pricing", "is_enabled", "is_hidden", "is_deprecated", "sort_order", "notes", "user_overrides", "created_at", "updated_at") SELECT "id", "provider_id", "model_id", "preset_model_id", "name", "description", "group", "capabilities", "input_modalities", "output_modalities", "endpoint_types", "custom_endpoint_url", "context_window", "max_output_tokens", "supports_streaming", "reasoning", "parameters", "pricing", "is_enabled", "is_hidden", "is_deprecated", "sort_order", "notes", "user_overrides", "created_at", "updated_at" FROM `user_model`;--> statement-breakpoint
DROP TABLE `user_model`;--> statement-breakpoint
ALTER TABLE `__new_user_model` RENAME TO `user_model`;--> statement-breakpoint
CREATE INDEX `user_model_preset_idx` ON `user_model` (`preset_model_id`);--> statement-breakpoint
CREATE INDEX `user_model_provider_enabled_idx` ON `user_model` (`provider_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_model_provider_sort_idx` ON `user_model` (`provider_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_model_provider_model_unique` ON `user_model` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `__new_user_provider` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`preset_provider_id` text,
	`name` text NOT NULL,
	`endpoint_configs` text,
	`default_chat_endpoint` text,
	`api_keys` text DEFAULT '[]',
	`auth_config` text,
	`api_features` text,
	`provider_settings` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_provider`("provider_id", "preset_provider_id", "name", "endpoint_configs", "default_chat_endpoint", "api_keys", "auth_config", "api_features", "provider_settings", "is_enabled", "sort_order", "created_at", "updated_at") SELECT "provider_id", "preset_provider_id", "name", "endpoint_configs", "default_chat_endpoint", "api_keys", "auth_config", "api_features", "provider_settings", "is_enabled", "sort_order", "created_at", "updated_at" FROM `user_provider`;--> statement-breakpoint
DROP TABLE `user_provider`;--> statement-breakpoint
ALTER TABLE `__new_user_provider` RENAME TO `user_provider`;--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_sort_idx` ON `user_provider` (`is_enabled`,`sort_order`);
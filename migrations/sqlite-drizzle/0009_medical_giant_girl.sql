CREATE TABLE `user_model` (
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
	`is_enabled` integer DEFAULT true,
	`is_hidden` integer DEFAULT false,
	`is_deprecated` integer DEFAULT false,
	`sort_order` integer DEFAULT 0,
	`notes` text,
	`user_overrides` text,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`provider_id`, `model_id`)
);
--> statement-breakpoint
CREATE INDEX `user_model_preset_idx` ON `user_model` (`preset_model_id`);--> statement-breakpoint
CREATE INDEX `user_model_provider_enabled_idx` ON `user_model` (`provider_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_model_provider_sort_idx` ON `user_model` (`provider_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `user_provider` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`preset_provider_id` text,
	`name` text NOT NULL,
	`endpoint_configs` text,
	`default_chat_endpoint` text,
	`api_keys` text DEFAULT '[]',
	`auth_config` text,
	`api_features` text,
	`provider_settings` text,
	`is_enabled` integer DEFAULT true,
	`sort_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_sort_idx` ON `user_provider` (`is_enabled`,`sort_order`);
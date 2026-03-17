CREATE TABLE `user_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`assistant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`emoji` text,
	`prompt` text DEFAULT '',
	`type` text DEFAULT 'assistant' NOT NULL,
	`model_id` text,
	`default_model_id` text,
	`settings` text,
	`enable_web_search` integer DEFAULT false,
	`web_search_provider_id` text,
	`enable_url_context` integer DEFAULT false,
	`enable_generate_image` integer DEFAULT false,
	`enable_memory` integer DEFAULT false,
	`knowledge_recognition` text DEFAULT 'off',
	`mcp_mode` text DEFAULT 'disabled',
	`mcp_servers` text,
	`knowledge_bases` text,
	`tags` text,
	`regular_phrases` text,
	`group` text,
	`is_default` integer DEFAULT false,
	`sort_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_assistant_assistantId_unique` ON `user_assistant` (`assistant_id`);--> statement-breakpoint
CREATE INDEX `user_assistant_type_idx` ON `user_assistant` (`type`);--> statement-breakpoint
CREATE INDEX `user_assistant_default_idx` ON `user_assistant` (`is_default`);--> statement-breakpoint
CREATE INDEX `user_assistant_sort_idx` ON `user_assistant` (`sort_order`);--> statement-breakpoint
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
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`preset_provider_id` text,
	`name` text NOT NULL,
	`base_urls` text,
	`models_api_urls` text,
	`default_chat_endpoint` text,
	`api_keys` text DEFAULT '[]',
	`auth_config` text,
	`api_features` text,
	`provider_settings` text,
	`reasoning_format_type` text,
	`websites` text,
	`is_enabled` integer DEFAULT true,
	`sort_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_provider_providerId_unique` ON `user_provider` (`provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_sort_idx` ON `user_provider` (`is_enabled`,`sort_order`);
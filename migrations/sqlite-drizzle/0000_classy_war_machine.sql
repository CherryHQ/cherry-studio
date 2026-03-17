CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `group_entity_sort_idx` ON `group` (`entity_type`,`sort_order`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`data` text NOT NULL,
	`searchable_text` text,
	`status` text NOT NULL,
	`siblings_group_id` integer DEFAULT 0,
	`assistant_id` text,
	`assistant_meta` text,
	`model_id` text,
	`model_meta` text,
	`trace_id` text,
	`stats` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "message_role_check" CHECK("message"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "message_status_check" CHECK("message"."status" IN ('pending', 'success', 'error', 'paused'))
);
--> statement-breakpoint
CREATE INDEX `message_parent_id_idx` ON `message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `message_topic_created_idx` ON `message` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_trace_id_idx` ON `message` (`trace_id`);--> statement-breakpoint
CREATE TABLE `preference` (
	`scope` text DEFAULT 'default' NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE TABLE `entity_tag` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`entity_type`, `entity_id`, `tag_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_tag_tag_id_idx` ON `entity_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`is_name_manually_edited` integer DEFAULT false,
	`assistant_id` text,
	`assistant_meta` text,
	`prompt` text,
	`active_node_id` text,
	`group_id` text,
	`sort_order` integer DEFAULT 0,
	`is_pinned` integer DEFAULT false,
	`pinned_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `topic_group_updated_idx` ON `topic` (`group_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_group_sort_idx` ON `topic` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_is_pinned_idx` ON `topic` (`is_pinned`,`pinned_order`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);--> statement-breakpoint
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
	`model_api_id` text,
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
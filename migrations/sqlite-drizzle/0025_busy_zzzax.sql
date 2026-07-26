PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`context_window` integer,
	`max_input_tokens` integer,
	`max_output_tokens` integer,
	`supports_streaming` integer,
	`reasoning` text,
	`parameters` text,
	`pricing` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`is_deprecated` integer DEFAULT false NOT NULL,
	`order_key` text NOT NULL,
	`notes` text,
	`user_overrides` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `user_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_model_custom_config_check" CHECK("__new_user_model"."preset_model_id" IS NOT NULL OR ("__new_user_model"."name" IS NOT NULL AND "__new_user_model"."capabilities" IS NOT NULL AND "__new_user_model"."supports_streaming" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_user_model`("id", "provider_id", "model_id", "preset_model_id", "name", "description", "group", "capabilities", "input_modalities", "output_modalities", "endpoint_types", "context_window", "max_input_tokens", "max_output_tokens", "supports_streaming", "reasoning", "parameters", "pricing", "is_enabled", "is_hidden", "is_deprecated", "order_key", "notes", "user_overrides", "created_at", "updated_at") SELECT "id", "provider_id", "model_id", "preset_model_id", "name", "description", "group", "capabilities", "input_modalities", "output_modalities", "endpoint_types", "context_window", "max_input_tokens", "max_output_tokens", "supports_streaming", "reasoning", "parameters", "pricing", "is_enabled", "is_hidden", "is_deprecated", "order_key", "notes", "user_overrides", "created_at", "updated_at" FROM `user_model`;--> statement-breakpoint
DROP TABLE `user_model`;--> statement-breakpoint
ALTER TABLE `__new_user_model` RENAME TO `user_model`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `user_model_preset_idx` ON `user_model` (`preset_model_id`);--> statement-breakpoint
CREATE INDEX `user_model_provider_enabled_idx` ON `user_model` (`provider_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_model_provider_id_order_key_idx` ON `user_model` (`provider_id`,`order_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_model_provider_model_unique` ON `user_model` (`provider_id`,`model_id`);
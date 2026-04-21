PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`is_enabled` integer DEFAULT true,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_provider`(
	"provider_id",
	"preset_provider_id",
	"name",
	"endpoint_configs",
	"default_chat_endpoint",
	"api_keys",
	"auth_config",
	"api_features",
	"provider_settings",
	"is_enabled",
	"order_key",
	"created_at",
	"updated_at"
)
SELECT
	"provider_id",
	"preset_provider_id",
	"name",
	"endpoint_configs",
	"default_chat_endpoint",
	"api_keys",
	"auth_config",
	"api_features",
	"provider_settings",
	"is_enabled",
	('a' || printf('%020d', COALESCE("sort_order", 0))),
	"created_at",
	"updated_at"
FROM `user_provider`;--> statement-breakpoint
DROP TABLE `user_provider`;--> statement-breakpoint
ALTER TABLE `__new_user_provider` RENAME TO `user_provider`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `user_provider_preset_idx` ON `user_provider` (`preset_provider_id`);--> statement-breakpoint
CREATE INDEX `user_provider_enabled_idx` ON `user_provider` (`is_enabled`);--> statement-breakpoint
CREATE INDEX `user_provider_order_key_idx` ON `user_provider` (`order_key`);

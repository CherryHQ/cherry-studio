PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`emoji` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`model_id` text,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Coalesce legacy NULL values to spec defaults so the rebuild never trips the new NOT NULL constraints.
-- prompt / description: type-level empty ('') matches the new DB DEFAULT.
-- emoji: product-chosen '🌟' matches the AssistantService.create() service-side default.
-- settings: DEFAULT_ASSISTANT_SETTINGS frozen at this migration's time of writing; new rows go through the service.
INSERT INTO `__new_assistant`("id", "name", "prompt", "emoji", "description", "model_id", "settings", "created_at", "updated_at", "deleted_at") SELECT "id", "name", COALESCE("prompt", ''), COALESCE("emoji", '🌟'), COALESCE("description", ''), "model_id", COALESCE("settings", '{"temperature":1,"enableTemperature":false,"topP":1,"enableTopP":false,"maxTokens":4096,"enableMaxTokens":false,"contextCount":5,"streamOutput":true,"reasoning_effort":"default","qwenThinkMode":false,"mcpMode":"auto","toolUseMode":"function","maxToolCalls":20,"enableMaxToolCalls":true,"enableWebSearch":false,"customParameters":[]}'), "created_at", "updated_at", "deleted_at" FROM `assistant`;--> statement-breakpoint
DROP TABLE `assistant`;--> statement-breakpoint
ALTER TABLE `__new_assistant` RENAME TO `assistant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assistant_created_at_idx` ON `assistant` (`created_at`);
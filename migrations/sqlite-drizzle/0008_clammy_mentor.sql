CREATE TABLE `usage_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`topic_id` text,
	`provider_id` text NOT NULL,
	`model_id` text,
	`modality` text DEFAULT 'language' NOT NULL,
	`api_key_id` text,
	`api_key_label` text,
	`api_key_masked` text,
	`api_key_attribution` text DEFAULT 'none' NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`reasoning_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`image_count` integer,
	`cost` real,
	`cost_currency` text,
	`cost_source` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "usage_ledger_attribution_check" CHECK("usage_ledger"."api_key_attribution" IN ('exact', 'rotation', 'backfill', 'auth', 'none')),
	CONSTRAINT "usage_ledger_cost_source_check" CHECK("usage_ledger"."cost_source" IN ('provider', 'computed')),
	CONSTRAINT "usage_ledger_modality_check" CHECK("usage_ledger"."modality" IN ('language', 'embedding', 'image'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_ledger_message_id_idx` ON `usage_ledger` (`message_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_provider_created_idx` ON `usage_ledger` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_ledger_api_key_created_idx` ON `usage_ledger` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_ledger_created_at_idx` ON `usage_ledger` (`created_at`);
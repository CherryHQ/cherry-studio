CREATE TABLE `usage_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`topic_id` text,
	`provider_id` text NOT NULL,
	`provider_name` text,
	`source_type` text,
	`source_id` text,
	`source_name` text,
	`source_icon` text,
	`model_id` text NOT NULL,
	`modality` text NOT NULL,
	`api_key_id` text,
	`api_key_label` text,
	`api_key_masked` text,
	`api_key_attribution` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`reasoning_tokens` integer,
	`no_cache_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`image_count` integer,
	`cost` real,
	`cost_currency` text,
	`cost_source` text,
	`cost_breakdown` text,
	`pricing_snapshot` text,
	`time_first_token_ms` integer,
	`time_completion_ms` integer,
	`time_thinking_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "usage_ledger_attribution_check" CHECK("usage_ledger"."api_key_attribution" IN ('exact', 'rotation', 'backfill', 'auth', 'none')),
	CONSTRAINT "usage_ledger_cost_source_check" CHECK("usage_ledger"."cost_source" IN ('provider', 'computed')),
	CONSTRAINT "usage_ledger_cost_tuple_check" CHECK((
        "usage_ledger"."cost" IS NULL
        AND "usage_ledger"."cost_currency" IS NULL
        AND "usage_ledger"."cost_source" IS NULL
        AND "usage_ledger"."cost_breakdown" IS NULL
        AND "usage_ledger"."pricing_snapshot" IS NULL
      ) OR (
        "usage_ledger"."cost" IS NOT NULL
        AND "usage_ledger"."cost_currency" IS NOT NULL
        AND "usage_ledger"."cost_source" IS NOT NULL
      )),
	CONSTRAINT "usage_ledger_api_key_identity_check" CHECK((
        "usage_ledger"."api_key_attribution" IN ('exact', 'rotation', 'backfill')
        AND "usage_ledger"."api_key_id" IS NOT NULL
      ) OR (
        "usage_ledger"."api_key_attribution" IN ('auth', 'none')
        AND "usage_ledger"."api_key_id" IS NULL
        AND "usage_ledger"."api_key_label" IS NULL
        AND "usage_ledger"."api_key_masked" IS NULL
      )),
	CONSTRAINT "usage_ledger_source_identity_check" CHECK((
        "usage_ledger"."source_type" IS NULL
        AND "usage_ledger"."source_id" IS NULL
        AND "usage_ledger"."source_name" IS NULL
        AND "usage_ledger"."source_icon" IS NULL
      ) OR (
        "usage_ledger"."source_type" IS NOT NULL
        AND "usage_ledger"."source_id" IS NOT NULL
      )),
	CONSTRAINT "usage_ledger_source_type_check" CHECK("usage_ledger"."source_type" IN ('assistant', 'agent')),
	CONSTRAINT "usage_ledger_modality_check" CHECK("usage_ledger"."modality" IN ('language', 'embedding', 'image')),
	CONSTRAINT "usage_ledger_image_count_check" CHECK((
        "usage_ledger"."modality" = 'image'
        AND "usage_ledger"."image_count" IS NOT NULL
        AND "usage_ledger"."image_count" > 0
      ) OR (
        "usage_ledger"."modality" <> 'image'
        AND "usage_ledger"."image_count" IS NULL
      )),
	CONSTRAINT "usage_ledger_cost_currency_check" CHECK("usage_ledger"."cost_currency" IN ('USD', 'CNY'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_ledger_request_id_idx` ON `usage_ledger` (`request_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_provider_created_idx` ON `usage_ledger` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_ledger_api_key_created_idx` ON `usage_ledger` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_ledger_source_created_idx` ON `usage_ledger` (`source_type`,`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_ledger_created_at_idx` ON `usage_ledger` (`created_at`);
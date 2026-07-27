CREATE TABLE `ai_usage_record` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`capture_source` text DEFAULT 'runtime' NOT NULL,
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
	`auth_method` text,
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
	CONSTRAINT "ai_usage_record_attribution_check" CHECK("ai_usage_record"."api_key_attribution" IN ('explicit', 'matched', 'auth', 'unknown')),
	CONSTRAINT "ai_usage_record_auth_method_check" CHECK("ai_usage_record"."auth_method" IN ('oauth', 'external-cli', 'iam-aws', 'api-key-aws', 'iam-gcp', 'iam-azure')),
	CONSTRAINT "ai_usage_record_capture_source_check" CHECK("ai_usage_record"."capture_source" IN ('runtime', 'persistence', 'migration')),
	CONSTRAINT "ai_usage_record_cost_source_check" CHECK("ai_usage_record"."cost_source" IN ('provider', 'computed')),
	CONSTRAINT "ai_usage_record_cost_tuple_check" CHECK((
        "ai_usage_record"."cost" IS NULL
        AND "ai_usage_record"."cost_currency" IS NULL
        AND "ai_usage_record"."cost_source" IS NULL
        AND "ai_usage_record"."cost_breakdown" IS NULL
        AND "ai_usage_record"."pricing_snapshot" IS NULL
      ) OR (
        "ai_usage_record"."cost" IS NOT NULL
        AND "ai_usage_record"."cost_currency" IS NOT NULL
        AND "ai_usage_record"."cost_source" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_api_key_identity_check" CHECK((
        "ai_usage_record"."api_key_attribution" IN ('explicit', 'matched')
        AND "ai_usage_record"."api_key_id" IS NOT NULL
        AND "ai_usage_record"."auth_method" IS NULL
      ) OR (
        "ai_usage_record"."api_key_attribution" = 'auth'
        AND "ai_usage_record"."api_key_id" IS NULL
        AND "ai_usage_record"."api_key_label" IS NULL
        AND "ai_usage_record"."api_key_masked" IS NULL
        AND "ai_usage_record"."auth_method" IS NOT NULL
      ) OR (
        "ai_usage_record"."api_key_attribution" = 'unknown'
        AND "ai_usage_record"."api_key_id" IS NULL
        AND "ai_usage_record"."api_key_label" IS NULL
        AND "ai_usage_record"."api_key_masked" IS NULL
        AND "ai_usage_record"."auth_method" IS NULL
      )),
	CONSTRAINT "ai_usage_record_source_identity_check" CHECK((
        "ai_usage_record"."source_type" IS NULL
        AND "ai_usage_record"."source_id" IS NULL
        AND "ai_usage_record"."source_name" IS NULL
        AND "ai_usage_record"."source_icon" IS NULL
      ) OR (
        "ai_usage_record"."source_type" IS NOT NULL
        AND "ai_usage_record"."source_id" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_source_type_check" CHECK("ai_usage_record"."source_type" IN ('assistant', 'agent')),
	CONSTRAINT "ai_usage_record_modality_check" CHECK("ai_usage_record"."modality" IN ('language', 'embedding', 'image')),
	CONSTRAINT "ai_usage_record_image_count_check" CHECK((
        "ai_usage_record"."modality" = 'image'
        AND "ai_usage_record"."image_count" IS NOT NULL
        AND "ai_usage_record"."image_count" > 0
      ) OR (
        "ai_usage_record"."modality" <> 'image'
        AND "ai_usage_record"."image_count" IS NULL
      )),
	CONSTRAINT "ai_usage_record_cost_currency_check" CHECK("ai_usage_record"."cost_currency" IN ('USD', 'CNY'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_record_request_id_idx` ON `ai_usage_record` (`request_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_provider_created_idx` ON `ai_usage_record` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_api_key_created_idx` ON `ai_usage_record` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_source_created_idx` ON `ai_usage_record` (`source_type`,`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_created_at_idx` ON `ai_usage_record` (`created_at`);
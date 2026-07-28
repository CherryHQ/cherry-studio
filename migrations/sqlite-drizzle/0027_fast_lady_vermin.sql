CREATE TABLE `ai_usage_record` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`record_kind` text NOT NULL,
	`request_count` integer NOT NULL,
	`message_kind` text,
	`message_id` text,
	`provider_id` text,
	`provider_name` text,
	`model_id` text,
	`model_name` text,
	`source_type` text,
	`source_id` text,
	`source_name` text,
	`source_icon` text,
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
	CONSTRAINT "ai_usage_record_record_kind_check" CHECK("ai_usage_record"."record_kind" IN ('invocation', 'legacy-aggregate')),
	CONSTRAINT "ai_usage_record_message_kind_check" CHECK("ai_usage_record"."message_kind" IN ('chat', 'agent-session')),
	CONSTRAINT "ai_usage_record_source_type_check" CHECK("ai_usage_record"."source_type" IN ('assistant', 'agent')),
	CONSTRAINT "ai_usage_record_modality_check" CHECK("ai_usage_record"."modality" IN ('language', 'embedding', 'image', 'rerank')),
	CONSTRAINT "ai_usage_record_attribution_check" CHECK("ai_usage_record"."api_key_attribution" IN ('explicit', 'matched', 'auth', 'unknown')),
	CONSTRAINT "ai_usage_record_auth_method_check" CHECK("ai_usage_record"."auth_method" IN ('oauth', 'external-cli', 'iam-aws', 'api-key-aws', 'iam-gcp', 'iam-azure')),
	CONSTRAINT "ai_usage_record_cost_source_check" CHECK("ai_usage_record"."cost_source" IN ('provider', 'computed')),
	CONSTRAINT "ai_usage_record_cost_currency_check" CHECK("ai_usage_record"."cost_currency" IN ('USD', 'CNY')),
	CONSTRAINT "ai_usage_record_kind_identity_check" CHECK((
        "ai_usage_record"."record_kind" = 'invocation'
        AND "ai_usage_record"."request_count" = 1
        AND "ai_usage_record"."provider_id" IS NOT NULL
        AND "ai_usage_record"."model_id" IS NOT NULL
      ) OR (
        "ai_usage_record"."record_kind" = 'legacy-aggregate'
        AND "ai_usage_record"."request_count" >= 1
        AND "ai_usage_record"."message_kind" IS NOT NULL
        AND "ai_usage_record"."message_id" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_message_identity_check" CHECK(("ai_usage_record"."message_kind" IS NULL AND "ai_usage_record"."message_id" IS NULL)
        OR ("ai_usage_record"."message_kind" IS NOT NULL AND "ai_usage_record"."message_id" IS NOT NULL)),
	CONSTRAINT "ai_usage_record_source_identity_check" CHECK((
        "ai_usage_record"."source_type" IS NULL
        AND "ai_usage_record"."source_id" IS NULL
        AND "ai_usage_record"."source_name" IS NULL
        AND "ai_usage_record"."source_icon" IS NULL
      ) OR (
        "ai_usage_record"."source_type" IS NOT NULL
        AND "ai_usage_record"."source_id" IS NOT NULL
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
	CONSTRAINT "ai_usage_record_cost_tuple_check" CHECK((
        "ai_usage_record"."cost" IS NULL
        AND "ai_usage_record"."cost_currency" IS NULL
        AND "ai_usage_record"."cost_source" IS NULL
        AND "ai_usage_record"."cost_breakdown" IS NULL
      ) OR (
        "ai_usage_record"."cost" IS NOT NULL
        AND "ai_usage_record"."cost_currency" IS NOT NULL
        AND "ai_usage_record"."cost_source" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_image_count_check" CHECK((
        "ai_usage_record"."modality" = 'image'
        AND "ai_usage_record"."image_count" IS NOT NULL
        AND "ai_usage_record"."image_count" >= 0
      ) OR (
        "ai_usage_record"."modality" <> 'image'
        AND "ai_usage_record"."image_count" IS NULL
      )),
	CONSTRAINT "ai_usage_record_nonnegative_check" CHECK(
        ("ai_usage_record"."input_tokens" IS NULL OR "ai_usage_record"."input_tokens" >= 0)
        AND ("ai_usage_record"."output_tokens" IS NULL OR "ai_usage_record"."output_tokens" >= 0)
        AND ("ai_usage_record"."total_tokens" IS NULL OR "ai_usage_record"."total_tokens" >= 0)
        AND ("ai_usage_record"."reasoning_tokens" IS NULL OR "ai_usage_record"."reasoning_tokens" >= 0)
        AND ("ai_usage_record"."no_cache_tokens" IS NULL OR "ai_usage_record"."no_cache_tokens" >= 0)
        AND ("ai_usage_record"."cache_read_tokens" IS NULL OR "ai_usage_record"."cache_read_tokens" >= 0)
        AND ("ai_usage_record"."cache_write_tokens" IS NULL OR "ai_usage_record"."cache_write_tokens" >= 0)
        AND ("ai_usage_record"."cost" IS NULL OR "ai_usage_record"."cost" >= 0)
        AND ("ai_usage_record"."time_first_token_ms" IS NULL OR "ai_usage_record"."time_first_token_ms" >= 0)
        AND ("ai_usage_record"."time_completion_ms" IS NULL OR "ai_usage_record"."time_completion_ms" >= 0)
        AND ("ai_usage_record"."time_thinking_ms" IS NULL OR "ai_usage_record"."time_thinking_ms" >= 0)
      ),
	CONSTRAINT "ai_usage_record_integer_check" CHECK(
        typeof("ai_usage_record"."request_count") = 'integer'
        AND ("ai_usage_record"."input_tokens" IS NULL OR typeof("ai_usage_record"."input_tokens") = 'integer')
        AND ("ai_usage_record"."output_tokens" IS NULL OR typeof("ai_usage_record"."output_tokens") = 'integer')
        AND ("ai_usage_record"."total_tokens" IS NULL OR typeof("ai_usage_record"."total_tokens") = 'integer')
        AND ("ai_usage_record"."reasoning_tokens" IS NULL OR typeof("ai_usage_record"."reasoning_tokens") = 'integer')
        AND ("ai_usage_record"."no_cache_tokens" IS NULL OR typeof("ai_usage_record"."no_cache_tokens") = 'integer')
        AND ("ai_usage_record"."cache_read_tokens" IS NULL OR typeof("ai_usage_record"."cache_read_tokens") = 'integer')
        AND ("ai_usage_record"."cache_write_tokens" IS NULL OR typeof("ai_usage_record"."cache_write_tokens") = 'integer')
        AND ("ai_usage_record"."image_count" IS NULL OR typeof("ai_usage_record"."image_count") = 'integer')
        AND ("ai_usage_record"."time_first_token_ms" IS NULL OR typeof("ai_usage_record"."time_first_token_ms") = 'integer')
        AND ("ai_usage_record"."time_completion_ms" IS NULL OR typeof("ai_usage_record"."time_completion_ms") = 'integer')
        AND ("ai_usage_record"."time_thinking_ms" IS NULL OR typeof("ai_usage_record"."time_thinking_ms") = 'integer')
        AND typeof("ai_usage_record"."created_at") = 'integer'
      ),
	CONSTRAINT "ai_usage_record_finite_cost_check" CHECK("ai_usage_record"."cost" IS NULL OR "ai_usage_record"."cost" <= 1.7976931348623157e308)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_record_request_id_idx` ON `ai_usage_record` (`request_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_created_at_idx` ON `ai_usage_record` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_message_created_idx` ON `ai_usage_record` (`message_kind`,`message_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_provider_created_idx` ON `ai_usage_record` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_model_created_idx` ON `ai_usage_record` (`model_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_api_key_created_idx` ON `ai_usage_record` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_source_created_idx` ON `ai_usage_record` (`source_type`,`source_id`,`created_at`);
CREATE TABLE `mini_app_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`logical_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `mini_app`(`app_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mafr_entry_id_idx` ON `mini_app_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `mafr_source_id_idx` ON `mini_app_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mafr_source_logical_name_unique_idx` ON `mini_app_file_ref` (`source_id`,`logical_name`);--> statement-breakpoint
CREATE TABLE `mini_app_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `mini_app`(`app_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mag_app_permission_unique_idx` ON `mini_app_grant` (`app_id`,`permission`);--> statement-breakpoint
CREATE TABLE `mini_app_installation` (
	`app_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`content_hash` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`source_origin` text,
	`source_origin_cn` text,
	`manifest_json` text NOT NULL,
	`previous_manifest_json` text,
	`previous_content_hash` text,
	`previous_grants_json` text,
	`previous_consented_declared_json` text,
	`consented_declared_json` text DEFAULT '[]' NOT NULL,
	`ai_model_id` text,
	`ai_quick_model_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `mini_app`(`app_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mai_source_check" CHECK("mini_app_installation"."source" IN ('file', 'url', 'builtin')),
	CONSTRAINT "mai_rollback_snapshot_all_or_none" CHECK(("mini_app_installation"."previous_content_hash" IS NULL AND "mini_app_installation"."previous_manifest_json" IS NULL
           AND "mini_app_installation"."previous_grants_json" IS NULL AND "mini_app_installation"."previous_consented_declared_json" IS NULL)
          OR ("mini_app_installation"."previous_content_hash" IS NOT NULL AND "mini_app_installation"."previous_manifest_json" IS NOT NULL
              AND "mini_app_installation"."previous_grants_json" IS NOT NULL AND "mini_app_installation"."previous_consented_declared_json" IS NOT NULL)),
	CONSTRAINT "mai_source_consistency" CHECK(("mini_app_installation"."source" IN ('file', 'builtin') AND "mini_app_installation"."source_url" IS NULL AND "mini_app_installation"."source_origin" IS NULL
           AND "mini_app_installation"."source_origin_cn" IS NULL)
          OR ("mini_app_installation"."source" = 'url' AND "mini_app_installation"."source_url" IS NOT NULL AND "mini_app_installation"."source_origin" IS NOT NULL))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_usage_record` (
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
	CONSTRAINT "ai_usage_record_record_kind_check" CHECK("__new_ai_usage_record"."record_kind" IN ('invocation', 'legacy-aggregate')),
	CONSTRAINT "ai_usage_record_message_kind_check" CHECK("__new_ai_usage_record"."message_kind" IN ('chat', 'agent-session')),
	CONSTRAINT "ai_usage_record_source_type_check" CHECK("__new_ai_usage_record"."source_type" IN ('assistant', 'agent', 'mini-app')),
	CONSTRAINT "ai_usage_record_modality_check" CHECK("__new_ai_usage_record"."modality" IN ('language', 'embedding', 'image', 'rerank')),
	CONSTRAINT "ai_usage_record_attribution_check" CHECK("__new_ai_usage_record"."api_key_attribution" IN ('explicit', 'matched', 'auth', 'unknown')),
	CONSTRAINT "ai_usage_record_auth_method_check" CHECK("__new_ai_usage_record"."auth_method" IN ('oauth', 'external-cli', 'iam-aws', 'api-key-aws', 'iam-gcp', 'iam-azure')),
	CONSTRAINT "ai_usage_record_cost_source_check" CHECK("__new_ai_usage_record"."cost_source" IN ('provider', 'computed')),
	CONSTRAINT "ai_usage_record_cost_currency_check" CHECK("__new_ai_usage_record"."cost_currency" IN ('USD', 'CNY')),
	CONSTRAINT "ai_usage_record_kind_identity_check" CHECK((
        "__new_ai_usage_record"."record_kind" = 'invocation'
        AND "__new_ai_usage_record"."request_count" = 1
        AND "__new_ai_usage_record"."provider_id" IS NOT NULL
        AND "__new_ai_usage_record"."model_id" IS NOT NULL
      ) OR (
        "__new_ai_usage_record"."record_kind" = 'legacy-aggregate'
        AND "__new_ai_usage_record"."request_count" >= 1
        AND "__new_ai_usage_record"."message_kind" IS NOT NULL
        AND "__new_ai_usage_record"."message_id" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_message_identity_check" CHECK(("__new_ai_usage_record"."message_kind" IS NULL AND "__new_ai_usage_record"."message_id" IS NULL)
        OR ("__new_ai_usage_record"."message_kind" IS NOT NULL AND "__new_ai_usage_record"."message_id" IS NOT NULL)),
	CONSTRAINT "ai_usage_record_source_identity_check" CHECK((
        "__new_ai_usage_record"."source_type" IS NULL
        AND "__new_ai_usage_record"."source_id" IS NULL
        AND "__new_ai_usage_record"."source_name" IS NULL
        AND "__new_ai_usage_record"."source_icon" IS NULL
      ) OR (
        "__new_ai_usage_record"."source_type" IS NOT NULL
        AND "__new_ai_usage_record"."source_id" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_api_key_identity_check" CHECK((
        "__new_ai_usage_record"."api_key_attribution" IN ('explicit', 'matched')
        AND "__new_ai_usage_record"."api_key_id" IS NOT NULL
        AND "__new_ai_usage_record"."auth_method" IS NULL
      ) OR (
        "__new_ai_usage_record"."api_key_attribution" = 'auth'
        AND "__new_ai_usage_record"."api_key_id" IS NULL
        AND "__new_ai_usage_record"."api_key_label" IS NULL
        AND "__new_ai_usage_record"."api_key_masked" IS NULL
        AND "__new_ai_usage_record"."auth_method" IS NOT NULL
      ) OR (
        "__new_ai_usage_record"."api_key_attribution" = 'unknown'
        AND "__new_ai_usage_record"."api_key_id" IS NULL
        AND "__new_ai_usage_record"."api_key_label" IS NULL
        AND "__new_ai_usage_record"."api_key_masked" IS NULL
        AND "__new_ai_usage_record"."auth_method" IS NULL
      )),
	CONSTRAINT "ai_usage_record_cost_tuple_check" CHECK((
        "__new_ai_usage_record"."cost" IS NULL
        AND "__new_ai_usage_record"."cost_currency" IS NULL
        AND "__new_ai_usage_record"."cost_source" IS NULL
        AND "__new_ai_usage_record"."cost_breakdown" IS NULL
      ) OR (
        "__new_ai_usage_record"."cost" IS NOT NULL
        AND "__new_ai_usage_record"."cost_currency" IS NOT NULL
        AND "__new_ai_usage_record"."cost_source" IS NOT NULL
      )),
	CONSTRAINT "ai_usage_record_image_count_check" CHECK((
        "__new_ai_usage_record"."modality" = 'image'
        AND "__new_ai_usage_record"."image_count" IS NOT NULL
        AND "__new_ai_usage_record"."image_count" >= 0
      ) OR (
        "__new_ai_usage_record"."modality" <> 'image'
        AND "__new_ai_usage_record"."image_count" IS NULL
      )),
	CONSTRAINT "ai_usage_record_nonnegative_check" CHECK(
        ("__new_ai_usage_record"."input_tokens" IS NULL OR "__new_ai_usage_record"."input_tokens" >= 0)
        AND ("__new_ai_usage_record"."output_tokens" IS NULL OR "__new_ai_usage_record"."output_tokens" >= 0)
        AND ("__new_ai_usage_record"."total_tokens" IS NULL OR "__new_ai_usage_record"."total_tokens" >= 0)
        AND ("__new_ai_usage_record"."reasoning_tokens" IS NULL OR "__new_ai_usage_record"."reasoning_tokens" >= 0)
        AND ("__new_ai_usage_record"."no_cache_tokens" IS NULL OR "__new_ai_usage_record"."no_cache_tokens" >= 0)
        AND ("__new_ai_usage_record"."cache_read_tokens" IS NULL OR "__new_ai_usage_record"."cache_read_tokens" >= 0)
        AND ("__new_ai_usage_record"."cache_write_tokens" IS NULL OR "__new_ai_usage_record"."cache_write_tokens" >= 0)
        AND ("__new_ai_usage_record"."cost" IS NULL OR "__new_ai_usage_record"."cost" >= 0)
        AND ("__new_ai_usage_record"."time_first_token_ms" IS NULL OR "__new_ai_usage_record"."time_first_token_ms" >= 0)
        AND ("__new_ai_usage_record"."time_completion_ms" IS NULL OR "__new_ai_usage_record"."time_completion_ms" >= 0)
        AND ("__new_ai_usage_record"."time_thinking_ms" IS NULL OR "__new_ai_usage_record"."time_thinking_ms" >= 0)
      ),
	CONSTRAINT "ai_usage_record_integer_check" CHECK(
        typeof("__new_ai_usage_record"."request_count") = 'integer'
        AND ("__new_ai_usage_record"."input_tokens" IS NULL OR typeof("__new_ai_usage_record"."input_tokens") = 'integer')
        AND ("__new_ai_usage_record"."output_tokens" IS NULL OR typeof("__new_ai_usage_record"."output_tokens") = 'integer')
        AND ("__new_ai_usage_record"."total_tokens" IS NULL OR typeof("__new_ai_usage_record"."total_tokens") = 'integer')
        AND ("__new_ai_usage_record"."reasoning_tokens" IS NULL OR typeof("__new_ai_usage_record"."reasoning_tokens") = 'integer')
        AND ("__new_ai_usage_record"."no_cache_tokens" IS NULL OR typeof("__new_ai_usage_record"."no_cache_tokens") = 'integer')
        AND ("__new_ai_usage_record"."cache_read_tokens" IS NULL OR typeof("__new_ai_usage_record"."cache_read_tokens") = 'integer')
        AND ("__new_ai_usage_record"."cache_write_tokens" IS NULL OR typeof("__new_ai_usage_record"."cache_write_tokens") = 'integer')
        AND ("__new_ai_usage_record"."image_count" IS NULL OR typeof("__new_ai_usage_record"."image_count") = 'integer')
        AND ("__new_ai_usage_record"."time_first_token_ms" IS NULL OR typeof("__new_ai_usage_record"."time_first_token_ms") = 'integer')
        AND ("__new_ai_usage_record"."time_completion_ms" IS NULL OR typeof("__new_ai_usage_record"."time_completion_ms") = 'integer')
        AND ("__new_ai_usage_record"."time_thinking_ms" IS NULL OR typeof("__new_ai_usage_record"."time_thinking_ms") = 'integer')
        AND typeof("__new_ai_usage_record"."created_at") = 'integer'
      ),
	CONSTRAINT "ai_usage_record_finite_cost_check" CHECK("__new_ai_usage_record"."cost" IS NULL OR "__new_ai_usage_record"."cost" <= 1.7976931348623157e308)
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage_record`("id", "request_id", "record_kind", "request_count", "message_kind", "message_id", "provider_id", "provider_name", "model_id", "model_name", "source_type", "source_id", "source_name", "source_icon", "modality", "api_key_id", "api_key_label", "api_key_masked", "api_key_attribution", "auth_method", "input_tokens", "output_tokens", "total_tokens", "reasoning_tokens", "no_cache_tokens", "cache_read_tokens", "cache_write_tokens", "image_count", "cost", "cost_currency", "cost_source", "cost_breakdown", "pricing_snapshot", "time_first_token_ms", "time_completion_ms", "time_thinking_ms", "created_at") SELECT "id", "request_id", "record_kind", "request_count", "message_kind", "message_id", "provider_id", "provider_name", "model_id", "model_name", "source_type", "source_id", "source_name", "source_icon", "modality", "api_key_id", "api_key_label", "api_key_masked", "api_key_attribution", "auth_method", "input_tokens", "output_tokens", "total_tokens", "reasoning_tokens", "no_cache_tokens", "cache_read_tokens", "cache_write_tokens", "image_count", "cost", "cost_currency", "cost_source", "cost_breakdown", "pricing_snapshot", "time_first_token_ms", "time_completion_ms", "time_thinking_ms", "created_at" FROM `ai_usage_record`;--> statement-breakpoint
DROP TABLE `ai_usage_record`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage_record` RENAME TO `ai_usage_record`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_record_request_id_idx` ON `ai_usage_record` (`request_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_created_at_idx` ON `ai_usage_record` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_message_created_idx` ON `ai_usage_record` (`message_kind`,`message_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_provider_created_idx` ON `ai_usage_record` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_model_created_idx` ON `ai_usage_record` (`model_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_api_key_created_idx` ON `ai_usage_record` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_record_source_created_idx` ON `ai_usage_record` (`source_type`,`source_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_mini_app` (
	`app_id` text PRIMARY KEY NOT NULL,
	`preset_mini_app_id` text,
	`kind` text DEFAULT 'site' NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`logo_key` text,
	`status` text DEFAULT 'enabled' NOT NULL,
	`order_key` text NOT NULL,
	`bordered` integer DEFAULT true NOT NULL,
	`background` text,
	`supported_regions` text,
	`configuration` text,
	`name_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mini_app_status_check" CHECK("__new_mini_app"."status" IN ('enabled', 'disabled', 'pinned')),
	CONSTRAINT "mini_app_kind_check" CHECK("__new_mini_app"."kind" IN ('site', 'app'))
);
--> statement-breakpoint
-- HAND EDIT, REDO IT AFTER EVERY `db:migrations:generate`: the old `mini_app` has no
-- `kind` column, so drizzle's generated `SELECT "kind"` cannot run. Every pre-existing
-- row is a website entry, which is what this migration's DEFAULT encodes for new rows.
-- Losing it fails at PREPARE time, empty table or not, so `applyMigrations.populated.test.ts`
-- catches it for as long as that file keeps replaying the tip chain over a baseline database.
INSERT INTO `__new_mini_app`("app_id", "preset_mini_app_id", "kind", "name", "url", "logo_key", "status", "order_key", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at") SELECT "app_id", "preset_mini_app_id", 'site', "name", "url", "logo_key", "status", "order_key", "bordered", "background", "supported_regions", "configuration", "name_key", "created_at", "updated_at" FROM `mini_app`;--> statement-breakpoint
DROP TABLE `mini_app`;--> statement-breakpoint
ALTER TABLE `__new_mini_app` RENAME TO `mini_app`;--> statement-breakpoint
CREATE INDEX `mini_app_status_order_key_idx` ON `mini_app` (`status`,`order_key`);--> statement-breakpoint
CREATE INDEX `mini_app_preset_mini_app_id_idx` ON `mini_app` (`preset_mini_app_id`);
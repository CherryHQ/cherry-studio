ALTER TABLE `usage_ledger` ADD `provider_name` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `source_type` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `source_name` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `source_icon` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `no_cache_tokens` integer;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `cost_breakdown` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `pricing_snapshot` text;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `time_first_token_ms` integer;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `time_completion_ms` integer;--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `time_thinking_ms` integer;--> statement-breakpoint
CREATE INDEX `usage_ledger_source_created_idx` ON `usage_ledger` (`source_type`,`source_id`,`created_at`);
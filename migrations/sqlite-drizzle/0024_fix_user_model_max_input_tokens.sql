ALTER TABLE `user_provider` ADD `order_key` text NOT NULL DEFAULT 'a0';
--> statement-breakpoint
DROP INDEX `user_provider_enabled_sort_idx`;
--> statement-breakpoint
CREATE INDEX `user_provider_enabled_idx` ON `user_provider` (`is_enabled`);
--> statement-breakpoint
CREATE INDEX `user_provider_order_key_idx` ON `user_provider` (`order_key`);
--> statement-breakpoint
ALTER TABLE `user_model` ADD `order_key` text NOT NULL DEFAULT 'a0';
--> statement-breakpoint
DROP INDEX `user_model_provider_sort_idx`;
--> statement-breakpoint
CREATE INDEX `user_model_provider_id_order_key_idx` ON `user_model` (`provider_id`, `order_key`);
--> statement-breakpoint
ALTER TABLE `user_model` ADD `max_input_tokens` integer;

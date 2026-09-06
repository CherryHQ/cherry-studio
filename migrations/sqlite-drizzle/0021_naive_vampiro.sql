ALTER TABLE `agent_session` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `assistant` ADD `deletion_batch_id` text;--> statement-breakpoint
ALTER TABLE `painting` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `topic` ADD `deletion_batch_id` text;
CREATE TABLE `memory_history` (
	`id` integer PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`action` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`memory_id`) REFERENCES `memory`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_history_action_check" CHECK("memory_history"."action" IN ('ADD', 'UPDATE', 'DELETE'))
);
--> statement-breakpoint
CREATE INDEX `memory_history_memory_id_created_at_idx` ON `memory_history` (`memory_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memory` (
	`id` text PRIMARY KEY NOT NULL,
	`memory` text NOT NULL,
	`hash` text NOT NULL,
	`embedding` F32_BLOB(1536),
	`metadata` text,
	`user_id` text,
	`agent_id` text,
	`run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "memory_hash_not_empty_check" CHECK("memory"."hash" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_hash_unique` ON `memory` (`hash`);--> statement-breakpoint
CREATE INDEX `memory_hash_idx` ON `memory` (`hash`);--> statement-breakpoint
CREATE INDEX `memory_user_id_idx` ON `memory` (`user_id`);--> statement-breakpoint
CREATE INDEX `memory_agent_id_idx` ON `memory` (`agent_id`);--> statement-breakpoint
CREATE INDEX `memory_created_at_idx` ON `memory` (`created_at`);
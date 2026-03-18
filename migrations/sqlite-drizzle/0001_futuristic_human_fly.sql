PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`data` text NOT NULL,
	`searchable_text` text,
	`status` text NOT NULL,
	`siblings_group_id` integer DEFAULT 0,
	`assistant_id` text,
	`assistant_meta` text,
	`model_id` text,
	`model_meta` text,
	`trace_id` text,
	`stats` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "message_role_check" CHECK("__new_message"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "message_status_check" CHECK("__new_message"."status" IN ('pending', 'success', 'error', 'paused'))
);
--> statement-breakpoint
INSERT INTO `__new_message`("id", "parent_id", "topic_id", "role", "data", "searchable_text", "status", "siblings_group_id", "assistant_id", "assistant_meta", "model_id", "model_meta", "trace_id", "stats", "created_at", "updated_at", "deleted_at") SELECT "id", "parent_id", "topic_id", "role", "data", "searchable_text", "status", "siblings_group_id", "assistant_id", "assistant_meta", "model_id", "model_meta", "trace_id", "stats", "created_at", "updated_at", "deleted_at" FROM `message`;--> statement-breakpoint
DROP TABLE `message`;--> statement-breakpoint
ALTER TABLE `__new_message` RENAME TO `message`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `message_parent_id_idx` ON `message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `message_topic_created_idx` ON `message` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_trace_id_idx` ON `message` (`trace_id`);
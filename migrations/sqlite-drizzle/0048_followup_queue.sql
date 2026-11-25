CREATE TABLE IF NOT EXISTS `followup_queue_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `followup_queue`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fqfr_role_check" CHECK("followup_queue_file_ref"."role" IN ('attachment'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fqfr_entry_id_idx` ON `followup_queue_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fqfr_source_id_idx` ON `followup_queue_file_ref` (`source_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `followup_queue_state` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `followup_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`draft` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` integer,
	`claim_token` text,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "followup_queue_status_check" CHECK("followup_queue"."status" IN ('pending', 'sending', 'failed', 'closed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `followup_queue_scope_key_idx` ON `followup_queue` (`scope_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `followup_queue_status_idx` ON `followup_queue` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `followup_queue_scope_key_order_key_idx` ON `followup_queue` (`scope_key`,`order_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_name_manually_edited` integer DEFAULT false NOT NULL,
	`assistant_id` text,
	`active_node_id` text,
	`trace_id` text,
	`order_key` text NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_topic`("id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at" FROM `topic`;--> statement-breakpoint
DROP TABLE `topic`;--> statement-breakpoint
ALTER TABLE `__new_topic` RENAME TO `topic`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topic_last_activity_at_idx` ON `topic` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topic_order_key_idx` ON `topic` (`order_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topic_assistant_id_idx` ON `topic` (`assistant_id`);
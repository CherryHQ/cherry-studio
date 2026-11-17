CREATE TABLE `followup_queue_file_ref` (
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
CREATE INDEX `fqfr_entry_id_idx` ON `followup_queue_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `fqfr_source_id_idx` ON `followup_queue_file_ref` (`source_id`);--> statement-breakpoint
CREATE TABLE `followup_queue_state` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `followup_queue` (
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
CREATE INDEX `followup_queue_scope_key_idx` ON `followup_queue` (`scope_key`);--> statement-breakpoint
CREATE INDEX `followup_queue_status_idx` ON `followup_queue` (`status`);--> statement-breakpoint
CREATE INDEX `followup_queue_scope_key_order_key_idx` ON `followup_queue` (`scope_key`,`order_key`);
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
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "followup_queue_status_check" CHECK("followup_queue"."status" IN ('pending', 'sending', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `followup_queue_scope_key_idx` ON `followup_queue` (`scope_key`);--> statement-breakpoint
CREATE INDEX `followup_queue_status_idx` ON `followup_queue` (`status`);--> statement-breakpoint
CREATE INDEX `followup_queue_scope_key_order_key_idx` ON `followup_queue` (`scope_key`,`order_key`);
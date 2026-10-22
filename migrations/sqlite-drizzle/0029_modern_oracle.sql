PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_followup_queue` (
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
	CONSTRAINT "followup_queue_status_check" CHECK("__new_followup_queue"."status" IN ('pending', 'sending', 'failed', 'closed'))
);
--> statement-breakpoint
INSERT INTO `__new_followup_queue`("id", "scope_key", "draft", "payload", "status", "sent_at", "claim_token", "order_key", "created_at", "updated_at") SELECT "id", "scope_key", "draft", "payload", "status", "sent_at", "claim_token", "order_key", "created_at", "updated_at" FROM `followup_queue`;--> statement-breakpoint
DROP TABLE `followup_queue`;--> statement-breakpoint
ALTER TABLE `__new_followup_queue` RENAME TO `followup_queue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `followup_queue_scope_key_idx` ON `followup_queue` (`scope_key`);--> statement-breakpoint
CREATE INDEX `followup_queue_status_idx` ON `followup_queue` (`status`);--> statement-breakpoint
CREATE INDEX `followup_queue_scope_key_order_key_idx` ON `followup_queue` (`scope_key`,`order_key`);
CREATE TABLE `creation` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`prompt` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creation_order_key_idx` ON `creation` (`order_key`);--> statement-breakpoint
DROP TABLE `painting`;
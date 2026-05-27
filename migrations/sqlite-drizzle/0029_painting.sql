CREATE TABLE `painting` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`model` text,
	`prompt` text,
	`negative_prompt` text,
	`status` text,
	`urls` text DEFAULT '[]' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "painting_provider_check" CHECK(length("painting"."provider") > 0),
	CONSTRAINT "painting_mode_check" CHECK("painting"."mode" IN ('generate', 'edit', 'remix', 'upscale', 'draw'))
);
--> statement-breakpoint
CREATE INDEX `painting_provider_mode_order_key_idx` ON `painting` (`provider`,`mode`,`order_key`);
--> statement-breakpoint
CREATE INDEX `painting_provider_mode_idx` ON `painting` (`provider`,`mode`);
--> statement-breakpoint
CREATE INDEX `painting_status_idx` ON `painting` (`status`);

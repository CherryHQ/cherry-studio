CREATE TABLE `prompt_binding` (
	`prompt_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`prompt_id`, `target_type`, `target_id`),
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prompt_binding_target_type_check" CHECK("prompt_binding"."target_type" IN ('assistant', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `prompt_binding_target_idx` ON `prompt_binding` (`target_type`,`target_id`,`prompt_id`);
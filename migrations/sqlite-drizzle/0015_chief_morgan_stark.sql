CREATE TABLE `prompt_binding` (
	`prompt_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`prompt_id`, `target_type`, `target_id`),
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prompt_binding_target_type_check" CHECK("prompt_binding"."target_type" IN ('assistant', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `prompt_binding_target_idx` ON `prompt_binding` (`target_type`,`target_id`,`prompt_id`);--> statement-breakpoint
CREATE INDEX `prompt_binding_target_order_key_idx` ON `prompt_binding` (`target_type`,`target_id`,`order_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`visibility` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "prompt_visibility_check" CHECK("__new_prompt"."visibility" IN ('global', 'restricted'))
);
--> statement-breakpoint
INSERT INTO `__new_prompt`("id", "title", "content", "visibility", "order_key", "created_at", "updated_at") SELECT "id", "title", "content", 'global', "order_key", "created_at", "updated_at" FROM `prompt`;--> statement-breakpoint
DROP TABLE `prompt`;--> statement-breakpoint
ALTER TABLE `__new_prompt` RENAME TO `prompt`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `prompt_order_key_idx` ON `prompt` (`order_key`);

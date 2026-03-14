ALTER TABLE `agents` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `sort_order` integer DEFAULT 0 NOT NULL;
ALTER TABLE `agents` ADD `sort_order` integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_agents_sort_order` ON `agents` (`sort_order`);

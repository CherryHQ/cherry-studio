ALTER TABLE `mcp_server` ADD `sort_order` integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX `mcp_server_sort_order_idx` ON `mcp_server` (`sort_order`);
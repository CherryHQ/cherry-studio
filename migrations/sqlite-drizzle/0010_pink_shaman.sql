CREATE TABLE `assistant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '',
	`emoji` text,
	`description` text DEFAULT '',
	`model_id` text,
	`settings` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `assistant_created_at_idx` ON `assistant` (`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_knowledge_base` (
	`assistant_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`assistant_id`, `knowledge_base_id`),
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assistant_mcp_server` (
	`assistant_id` text NOT NULL,
	`mcp_server_id` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`assistant_id`, `mcp_server_id`),
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `message` ADD `model_snapshot` text;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `assistant_id`;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `assistant_meta`;--> statement-breakpoint
ALTER TABLE `message` DROP COLUMN `model_meta`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`is_name_manually_edited` integer DEFAULT false,
	`assistant_id` text,
	`active_node_id` text,
	`group_id` text,
	`sort_order` integer DEFAULT 0,
	`is_pinned` integer DEFAULT false,
	`pinned_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_topic`("id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "group_id", "sort_order", "is_pinned", "pinned_order", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "group_id", "sort_order", "is_pinned", "pinned_order", "created_at", "updated_at", "deleted_at" FROM `topic`;--> statement-breakpoint
DROP TABLE `topic`;--> statement-breakpoint
ALTER TABLE `__new_topic` RENAME TO `topic`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `topic_group_updated_idx` ON `topic` (`group_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_group_sort_idx` ON `topic` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_is_pinned_idx` ON `topic` (`is_pinned`,`pinned_order`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);
CREATE TABLE `file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_ref_node_id_idx` ON `file_ref` (`node_id`);--> statement-breakpoint
CREATE INDEX `file_ref_source_idx` ON `file_ref` (`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_ref_unique_idx` ON `file_ref` (`node_id`,`source_type`,`source_id`,`role`);--> statement-breakpoint
CREATE TABLE `node` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`ext` text,
	`parent_id` text,
	`mount_id` text NOT NULL,
	`size` integer,
	`provider_config` text,
	`is_readonly` integer DEFAULT false,
	`remote_id` text,
	`cached_at` integer,
	`previous_parent_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "node_type_check" CHECK("node"."type" IN ('file', 'dir', 'mount'))
);
--> statement-breakpoint
CREATE INDEX `node_parent_id_idx` ON `node` (`parent_id`);--> statement-breakpoint
CREATE INDEX `node_mount_id_idx` ON `node` (`mount_id`);--> statement-breakpoint
CREATE INDEX `node_mount_type_idx` ON `node` (`mount_id`,`type`);--> statement-breakpoint
CREATE INDEX `node_name_idx` ON `node` (`name`);--> statement-breakpoint
CREATE INDEX `node_updated_at_idx` ON `node` (`updated_at`);
CREATE TABLE `branch_anchor` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_topic_id` text NOT NULL,
	`branch_topic_id` text NOT NULL,
	`message_id` text NOT NULL,
	`block_id` text NOT NULL,
	`selected_text` text NOT NULL,
	`selection_start` integer NOT NULL,
	`selection_end` integer NOT NULL,
	`disposition` text DEFAULT 'kept' NOT NULL,
	`summary` text,
	`summary_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "branch_anchor_disposition_check" CHECK("branch_anchor"."disposition" IN ('pending', 'kept'))
);
--> statement-breakpoint
CREATE INDEX `branch_anchor_parent_topic_id_idx` ON `branch_anchor` (`parent_topic_id`);--> statement-breakpoint
CREATE INDEX `branch_anchor_branch_topic_id_idx` ON `branch_anchor` (`branch_topic_id`);
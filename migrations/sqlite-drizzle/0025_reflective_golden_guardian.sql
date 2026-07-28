CREATE TABLE `topic_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`first_message_id` text NOT NULL,
	`last_message_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_provenance_first_message_id_uq` ON `topic_provenance` (`first_message_id`);--> statement-breakpoint
CREATE INDEX `topic_provenance_topic_kind_idx` ON `topic_provenance` (`topic_id`,`kind`);
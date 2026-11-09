CREATE TABLE `side_chat` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`source_topic_id` text NOT NULL,
	`metadata` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `side_chat_source_topic_idx` ON `side_chat` (`source_topic_id`);
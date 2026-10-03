CREATE TABLE `agent_background_task` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`status` text NOT NULL,
	`record` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_background_task_agent_started_idx` ON `agent_background_task` (`agent_id`,`started_at`);
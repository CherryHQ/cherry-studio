CREATE TABLE `agent_plan_history` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `agent_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_plan_history_revision_uq` ON `agent_plan_history` (`plan_id`,`revision`);--> statement-breakpoint
CREATE TABLE `agent_plan_step_identity` (
	`plan_id` text NOT NULL,
	`step_id` text NOT NULL,
	PRIMARY KEY(`plan_id`, `step_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `agent_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_plan_sessionId_unique` ON `agent_plan` (`session_id`);
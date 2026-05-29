CREATE TABLE `job_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`trigger` text NOT NULL,
	`job_input_template` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run` integer,
	`last_run` integer,
	`catch_up_policy` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_schedule_type_name_uq` ON `job_schedule` (`type`,`name`);--> statement-breakpoint
CREATE INDEX `job_schedule_enabled_next_run_idx` ON `job_schedule` (`enabled`,`next_run`);--> statement-breakpoint
CREATE INDEX `job_schedule_type_idx` ON `job_schedule` (`type`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`queue` text NOT NULL,
	`idempotency_key` text,
	`schedule_id` text,
	`scheduled_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`parent_id` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`timeout_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `job_schedule`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "job_status_check" CHECK("job"."status" IN ('pending','delayed','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `job_queue_status_scheduled_at_idx` ON `job` (`queue`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_status_idx` ON `job` (`status`);--> statement-breakpoint
CREATE INDEX `job_schedule_id_finished_at_idx` ON `job` (`schedule_id`,`finished_at`);--> statement-breakpoint
CREATE INDEX `job_parent_id_idx` ON `job` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_idempotency_key_partial_uq` ON `job` (`idempotency_key`) WHERE "job"."idempotency_key" IS NOT NULL AND "job"."status" NOT IN ('completed','failed','cancelled');
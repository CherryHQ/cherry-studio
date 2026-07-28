CREATE TABLE `learning_external_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`learning_unit_id` text NOT NULL,
	`target` text NOT NULL,
	`state` text NOT NULL,
	`external_path` text,
	`source_revision` text NOT NULL,
	`synced_revision` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`learning_unit_id`) REFERENCES `learning_unit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_external_sync_unit_target_uq` ON `learning_external_sync` (`learning_unit_id`,`target`);--> statement-breakpoint
CREATE INDEX `learning_external_sync_target_state_updated_at_idx` ON `learning_external_sync` (`target`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_source` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`status` text NOT NULL,
	`source_language` text,
	`target_language` text,
	`source_text` text NOT NULL,
	`target_text` text NOT NULL,
	`error` text,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_source_kind_record_revision_uq` ON `learning_source` (`kind`,`source_record_id`,`source_revision`);--> statement-breakpoint
CREATE INDEX `learning_source_status_updated_at_idx` ON `learning_source` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_unit_source` (
	`learning_unit_id` text NOT NULL,
	`learning_source_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`learning_unit_id`, `learning_source_id`),
	FOREIGN KEY (`learning_unit_id`) REFERENCES `learning_unit`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`learning_source_id`) REFERENCES `learning_source`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_unit_source_source_id_idx` ON `learning_unit_source` (`learning_source_id`);--> statement-breakpoint
CREATE TABLE `learning_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`english` text NOT NULL,
	`normalized_english` text NOT NULL,
	`meaning` text NOT NULL,
	`usage_note` text,
	`example` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`cefr` text,
	`exact_hash` text NOT NULL,
	`extraction_confidence` real,
	`is_user_edited` integer DEFAULT false NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_unit_exact_hash_uq` ON `learning_unit` (`exact_hash`);--> statement-breakpoint
CREATE INDEX `learning_unit_kind_updated_at_idx` ON `learning_unit` (`kind`,`updated_at`);--> statement-breakpoint
CREATE TABLE `practice_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_session_id` text NOT NULL,
	`learning_unit_id` text,
	`prompt` text NOT NULL,
	`transcript` text,
	`response_text` text,
	`feedback` text DEFAULT '{}' NOT NULL,
	`recognition_confidence` real,
	`text_similarity` real,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`attempted_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practice_session_id`) REFERENCES `practice_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`learning_unit_id`) REFERENCES `learning_unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `practice_attempt_session_attempted_at_idx` ON `practice_attempt` (`practice_session_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `practice_attempt_unit_id_idx` ON `practice_attempt` (`learning_unit_id`);--> statement-breakpoint
CREATE TABLE `practice_session` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`scenario` text,
	`model_id` text,
	`provider_id` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `practice_session_started_at_idx` ON `practice_session` (`started_at`);--> statement-breakpoint
CREATE TABLE `review_card` (
	`id` text PRIMARY KEY NOT NULL,
	`learning_unit_id` text NOT NULL,
	`direction` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`learning_unit_id`) REFERENCES `learning_unit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_card_unit_direction_uq` ON `review_card` (`learning_unit_id`,`direction`);--> statement-breakpoint
CREATE INDEX `review_card_unit_id_idx` ON `review_card` (`learning_unit_id`);--> statement-breakpoint
CREATE TABLE `review_state` (
	`card_id` text PRIMARY KEY NOT NULL,
	`due_at` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`phase` text NOT NULL,
	`last_review_at` integer,
	`suspended` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `review_card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_state_due_at_suspended_idx` ON `review_state` (`due_at`,`suspended`);--> statement-breakpoint
CREATE TABLE `review_event` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text,
	`rating` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`previous_state` text NOT NULL,
	`next_state` text NOT NULL,
	`client_mutation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `review_card`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_event_client_mutation_id_uq` ON `review_event` (`client_mutation_id`);--> statement-breakpoint
CREATE INDEX `review_event_card_reviewed_at_idx` ON `review_event` (`card_id`,`reviewed_at`);
CREATE TABLE `agent_runtime_backend` (
	`id` text PRIMARY KEY NOT NULL,
	`locator` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "agent_runtime_backend_state_check" CHECK("agent_runtime_backend"."state" IN ('creating', 'bound'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_backend_locator_uniq` ON `agent_runtime_backend` (`locator`);--> statement-breakpoint
CREATE TABLE `agent_session_context` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`backend_id` text NOT NULL,
	`intended_thread_id` text,
	`native_thread_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backend_id`) REFERENCES `agent_runtime_backend`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agent_session_context_backend_idx` ON `agent_session_context` (`backend_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_context_native_uniq` ON `agent_session_context` (`session_id`,`backend_id`,`native_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_context_intent_uniq` ON `agent_session_context` (`session_id`,`backend_id`,`intended_thread_id`);--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `submission` text;
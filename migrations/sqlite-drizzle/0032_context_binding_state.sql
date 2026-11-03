PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_session_context` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`backend_id` text NOT NULL,
	`native_thread_id` text,
	`binding_state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backend_id`) REFERENCES `agent_runtime_backend`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_session_context_binding_state_check" CHECK("__new_agent_session_context"."binding_state" IN ('pending', 'bound')),
	CONSTRAINT "agent_session_context_bound_identity_check" CHECK("__new_agent_session_context"."binding_state" != 'bound' OR "__new_agent_session_context"."native_thread_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_agent_session_context`("id", "session_id", "backend_id", "native_thread_id", "binding_state", "created_at", "updated_at") SELECT "id", "session_id", "backend_id", COALESCE("native_thread_id", "intended_thread_id"), CASE WHEN "native_thread_id" IS NULL THEN 'pending' ELSE 'bound' END, "created_at", "updated_at" FROM `agent_session_context`;--> statement-breakpoint
DROP TABLE `agent_session_context`;--> statement-breakpoint
ALTER TABLE `__new_agent_session_context` RENAME TO `agent_session_context`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_session_context_backend_idx` ON `agent_session_context` (`backend_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_context_native_uniq` ON `agent_session_context` (`session_id`,`backend_id`,`native_thread_id`);

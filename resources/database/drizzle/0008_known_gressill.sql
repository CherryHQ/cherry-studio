CREATE TABLE `collaboration_room_members` (
	`room_id` text NOT NULL,
	`member_type` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'participant' NOT NULL,
	`display_name` text,
	`metadata` text,
	`joined_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `member_type`, `member_id`),
	FOREIGN KEY (`room_id`) REFERENCES `collaboration_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "collab_room_members_type_check" CHECK("collaboration_room_members"."member_type" IN ('user', 'agent')),
	CONSTRAINT "collab_room_members_role_check" CHECK("collaboration_room_members"."role" IN ('owner', 'participant'))
);
--> statement-breakpoint
CREATE INDEX `collab_room_members_member_idx` ON `collaboration_room_members` (`member_type`,`member_id`);--> statement-breakpoint
CREATE TABLE `collaboration_room_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text,
	`kind` text DEFAULT 'message' NOT NULL,
	`intent` text DEFAULT 'message' NOT NULL,
	`routing` text DEFAULT 'none' NOT NULL,
	`parent_message_id` text,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `collaboration_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "collab_room_messages_author_type_check" CHECK("collaboration_room_messages"."author_type" IN ('user', 'agent', 'system')),
	CONSTRAINT "collab_room_messages_kind_check" CHECK("collaboration_room_messages"."kind" IN ('message', 'task', 'event')),
	CONSTRAINT "collab_room_messages_intent_check" CHECK("collaboration_room_messages"."intent" IN ('message', 'task')),
	CONSTRAINT "collab_room_messages_routing_check" CHECK("collaboration_room_messages"."routing" IN ('none', 'elite'))
);
--> statement-breakpoint
CREATE INDEX `collab_room_messages_room_idx` ON `collaboration_room_messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `collab_room_messages_parent_idx` ON `collaboration_room_messages` (`parent_message_id`);--> statement-breakpoint
CREATE INDEX `collab_room_messages_intent_idx` ON `collaboration_room_messages` (`intent`);--> statement-breakpoint
CREATE TABLE `collaboration_room_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`worker_agent_id` text NOT NULL,
	`trigger_message_id` text,
	`session_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`command_snapshot` text,
	`args_snapshot` text,
	`summary` text,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`room_id`) REFERENCES `collaboration_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worker_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_message_id`) REFERENCES `collaboration_room_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collab_room_runs_status_check" CHECK("collaboration_room_runs"."status" IN ('queued', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `collab_room_runs_room_idx` ON `collaboration_room_runs` (`room_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `collab_room_runs_worker_idx` ON `collaboration_room_runs` (`worker_agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `collab_room_runs_status_idx` ON `collaboration_room_runs` (`status`);--> statement-breakpoint
CREATE TABLE `collaboration_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`assigned_agent_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `collaboration_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collab_rooms_status_check" CHECK("collaboration_rooms"."status" IN ('todo', 'in_progress', 'needs_confirmation', 'done', 'blocked'))
);
--> statement-breakpoint
CREATE INDEX `collab_rooms_workspace_idx` ON `collaboration_rooms` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `collab_rooms_status_idx` ON `collaboration_rooms` (`status`);--> statement-breakpoint
CREATE INDEX `collab_rooms_assigned_agent_idx` ON `collaboration_rooms` (`assigned_agent_id`);--> statement-breakpoint
CREATE INDEX `collab_rooms_last_activity_idx` ON `collaboration_rooms` (`last_activity_at`);--> statement-breakpoint
CREATE TABLE `collaboration_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`root_paths` text DEFAULT '[]' NOT NULL,
	`router_agent_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`router_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collab_workspaces_name_idx` ON `collaboration_workspaces` (`name`);--> statement-breakpoint
CREATE INDEX `collab_workspaces_router_agent_idx` ON `collaboration_workspaces` (`router_agent_id`);
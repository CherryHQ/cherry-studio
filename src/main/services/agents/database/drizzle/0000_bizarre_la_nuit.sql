CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'claude-code' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar` text,
	`instructions` text,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`built_in_tools` text,
	`mcps` text,
	`knowledges` text,
	`configuration` text,
	`accessible_paths` text,
	`permission_mode` text DEFAULT 'default',
	`max_steps` integer DEFAULT 10,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` integer,
	`role` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`main_agent_id` text NOT NULL,
	`sub_agent_ids` text,
	`user_goal` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`external_session_id` text,
	`model` text,
	`plan_model` text,
	`small_model` text,
	`built_in_tools` text,
	`mcps` text,
	`knowledges` text,
	`configuration` text,
	`accessible_paths` text,
	`permission_mode` text DEFAULT 'default',
	`max_steps` integer DEFAULT 10,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

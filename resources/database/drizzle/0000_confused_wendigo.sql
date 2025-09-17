--> statement-breakpoint
CREATE TABLE `migrations` (
	`version` integer PRIMARY KEY NOT NULL,
	`tag` text NOT NULL,
	`executed_at` integer NOT NULL
);

CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accessible_paths` text,
	`instructions` text,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`mcps` text,
	`allowed_tools` text,
	`configuration` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_type` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accessible_paths` text,
	`instructions` text,
	`model` text NOT NULL,
	`plan_model` text,
	`small_model` text,
	`mcps` text,
	`allowed_tools` text,
	`configuration` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE TABLE `session_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

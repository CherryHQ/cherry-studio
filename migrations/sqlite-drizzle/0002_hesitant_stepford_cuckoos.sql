CREATE TABLE `websearch_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`api_key` text,
	`api_host` text,
	`engines` text,
	`using_browser` integer DEFAULT false,
	`basic_auth_username` text,
	`basic_auth_password` text,
	`created_at` integer,
	`updated_at` integer
);

ALTER TABLE `painting` ADD `project_id` text REFERENCES painting(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `painting` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `painting` ADD `step_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `painting` ADD `source_file_id` text;--> statement-breakpoint
ALTER TABLE `painting` ADD `operation` text DEFAULT 'generate' NOT NULL;--> statement-breakpoint
ALTER TABLE `painting` ADD `params` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `painting` ADD `step_status` text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE `painting` ADD `step_error` text;--> statement-breakpoint
ALTER TABLE `painting` ADD `selected_step_id` text;--> statement-breakpoint
ALTER TABLE `painting` ADD `selected_file_id` text;--> statement-breakpoint
CREATE INDEX `painting_project_idx` ON `painting` (`project_id`);
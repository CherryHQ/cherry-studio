CREATE TABLE `course_lesson` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`title` text NOT NULL,
	`page_start` integer,
	`page_end` integer,
	`chunk_start` integer,
	`chunk_end` integer,
	`status` text DEFAULT 'locked' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "course_lesson_status_check" CHECK("course_lesson"."status" IN ('locked','ready','in_progress','completed'))
);
--> statement-breakpoint
CREATE INDEX `course_lesson_course_sort_idx` ON `course_lesson` (`course_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `course` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`current_lesson_id` text,
	`syllabus_job_id` text,
	`syllabus_status` text DEFAULT 'pending' NOT NULL,
	`total_lessons` integer DEFAULT 0 NOT NULL,
	`completed_lessons` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "course_syllabus_status_check" CHECK("course"."syllabus_status" IN ('pending','building','ready','failed'))
);
--> statement-breakpoint
CREATE INDEX `course_knowledge_base_idx` ON `course` (`knowledge_base_id`);
CREATE TABLE `diagnostic_report` (
	`report_id` text PRIMARY KEY NOT NULL,
	`submitted_at` integer NOT NULL,
	`processing_status` text,
	`last_checked_at` integer,
	CONSTRAINT "diagnostic_report_processing_status_check" CHECK("diagnostic_report"."processing_status" IN ('pending', 'unprocessed', 'investigating', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `diagnostic_report_submitted_at_idx` ON `diagnostic_report` (`submitted_at`,`report_id`);
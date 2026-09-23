-- Earlier versions did not remove receipts when their paired device was deleted.
DELETE FROM `remote_command`
WHERE NOT EXISTS (
  SELECT 1 FROM `api_gateway_paired_device`
  WHERE `api_gateway_paired_device`.`id` = `remote_command`.`device_id`
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_remote_command` (
	`device_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`command_id` text NOT NULL,
	`method` text NOT NULL,
	`identity_digest` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`execution_id` text,
	`result` text,
	`error` text,
	`admitted_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `grant_id`, `command_id`),
	FOREIGN KEY (`device_id`) REFERENCES `api_gateway_paired_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_remote_command`("device_id", "grant_id", "command_id", "method", "identity_digest", "status", "session_id", "execution_id", "result", "error", "admitted_at", "created_at", "updated_at") SELECT "device_id", "grant_id", "command_id", "method", "identity_digest", "status", "session_id", "execution_id", "result", "error", "admitted_at", "created_at", "updated_at" FROM `remote_command`;--> statement-breakpoint
DROP TABLE `remote_command`;--> statement-breakpoint
ALTER TABLE `__new_remote_command` RENAME TO `remote_command`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

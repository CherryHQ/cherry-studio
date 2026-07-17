ALTER TABLE `agent_session` ADD `last_activity_at` integer;--> statement-breakpoint
ALTER TABLE `topic` ADD `last_activity_at` integer;--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `terminal_at` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `terminal_at` integer;--> statement-breakpoint
UPDATE `message`
SET `terminal_at` = `updated_at`
WHERE `role` = 'assistant'
  AND `status` IN ('success', 'error', 'paused');--> statement-breakpoint
UPDATE `agent_session_message`
SET `terminal_at` = `updated_at`
WHERE `role` = 'assistant'
  AND `status` IN ('success', 'error', 'paused');--> statement-breakpoint
UPDATE `topic`
SET `last_activity_at` = max(
  `created_at`,
  coalesce((
    SELECT max(CASE
      WHEN `message`.`role` = 'user' THEN `message`.`created_at`
      WHEN `message`.`role` = 'assistant'
        THEN max(`message`.`created_at`, coalesce(`message`.`terminal_at`, `message`.`created_at`))
      ELSE NULL
    END)
    FROM `message`
    WHERE `message`.`topic_id` = `topic`.`id`
      AND `message`.`deleted_at` IS NULL
  ), `created_at`)
);--> statement-breakpoint
UPDATE `agent_session`
SET `last_activity_at` = max(
  `created_at`,
  coalesce((
    SELECT max(CASE
      WHEN `agent_session_message`.`role` = 'user' THEN `agent_session_message`.`created_at`
      WHEN `agent_session_message`.`role` = 'assistant'
        THEN max(
          `agent_session_message`.`created_at`,
          coalesce(`agent_session_message`.`terminal_at`, `agent_session_message`.`created_at`)
        )
      ELSE NULL
    END)
    FROM `agent_session_message`
    WHERE `agent_session_message`.`session_id` = `agent_session`.`id`
  ), `created_at`)
);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_session` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`is_name_manually_edited` integer DEFAULT false NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`workspace_id` text NOT NULL,
	`trace_id` text,
	`order_key` text NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `agent_workspace`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_agent_session`("id", "agent_id", "name", "is_name_manually_edited", "description", "workspace_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at") SELECT "id", "agent_id", "name", "is_name_manually_edited", "description", "workspace_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at" FROM `agent_session`;--> statement-breakpoint
DROP TABLE `agent_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_session` RENAME TO `agent_session`;--> statement-breakpoint
CREATE TABLE `__new_topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_name_manually_edited` integer DEFAULT false NOT NULL,
	`assistant_id` text,
	`active_node_id` text,
	`trace_id` text,
	`order_key` text NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_topic`("id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "is_name_manually_edited", "assistant_id", "active_node_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at" FROM `topic`;--> statement-breakpoint
DROP TABLE `topic`;--> statement-breakpoint
ALTER TABLE `__new_topic` RENAME TO `topic`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_session_created_at_id_idx` ON `agent_session` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_last_activity_at_id_idx` ON `agent_session` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `agent_session_order_key_idx` ON `agent_session` (`order_key`);--> statement-breakpoint
CREATE INDEX `agent_session_updated_at_id_idx` ON `agent_session` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_created_at_id_idx` ON `topic` ("created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_last_activity_at_id_idx` ON `topic` ("last_activity_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_id_idx` ON `topic` ("updated_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `topic_order_key_idx` ON `topic` (`order_key`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);

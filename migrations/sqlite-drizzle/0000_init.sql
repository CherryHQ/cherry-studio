CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `entity_tag` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`entity_type`, `entity_id`, `tag_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_tag_tag_id_idx` ON `entity_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `group_entity_sort_idx` ON `group` (`entity_type`,`sort_order`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`parent_id` text,
	`response_group_id` integer DEFAULT 0,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`assistant_id` text,
	`assistant_meta` text,
	`model_id` text,
	`model_meta` text,
	`data` text NOT NULL,
	`usage` text,
	`metrics` text,
	`trace_id` text,
	`searchable_text` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "message_role_check" CHECK("message"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "message_status_check" CHECK("message"."status" IN ('success', 'error', 'paused'))
);
--> statement-breakpoint
CREATE INDEX `message_parent_id_idx` ON `message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `message_topic_created_idx` ON `message` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_trace_id_idx` ON `message` (`trace_id`);--> statement-breakpoint
CREATE TABLE `preference` (
	`scope` text DEFAULT 'default' NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `topic` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`assistant_id` text,
	`assistant_meta` text,
	`prompt` text,
	`group_id` text,
	`is_pinned` integer DEFAULT false,
	`pinned_order` integer DEFAULT 0,
	`sort_order` integer DEFAULT 0,
	`is_name_manually_edited` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `topic_group_updated_idx` ON `topic` (`group_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_group_sort_idx` ON `topic` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `topic_updated_at_idx` ON `topic` (`updated_at`);--> statement-breakpoint
CREATE INDEX `topic_is_pinned_idx` ON `topic` (`is_pinned`,`pinned_order`);--> statement-breakpoint
CREATE INDEX `topic_assistant_id_idx` ON `topic` (`assistant_id`);
--> statement-breakpoint
-- ============================================================
-- FTS5 Virtual Table and Triggers for Message Full-Text Search
-- ============================================================

-- 1. Create FTS5 virtual table with external content
--    Links to message table's searchable_text column
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  searchable_text,
  content='message',
  content_rowid='rowid',
  tokenize='trigram'
);--> statement-breakpoint

-- 2. Trigger: populate searchable_text and sync FTS on INSERT
CREATE TRIGGER IF NOT EXISTS message_ai AFTER INSERT ON message BEGIN
  -- Extract searchable text from data.blocks
  UPDATE message SET searchable_text = (
    SELECT group_concat(json_extract(value, '$.content'), ' ')
    FROM json_each(json_extract(NEW.data, '$.blocks'))
    WHERE json_extract(value, '$.type') = 'main_text'
  ) WHERE id = NEW.id;
  -- Sync to FTS5
  INSERT INTO message_fts(rowid, searchable_text)
  SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
END;--> statement-breakpoint

-- 3. Trigger: sync FTS on DELETE
CREATE TRIGGER IF NOT EXISTS message_ad AFTER DELETE ON message BEGIN
  INSERT INTO message_fts(message_fts, rowid, searchable_text)
  VALUES ('delete', OLD.rowid, OLD.searchable_text);
END;--> statement-breakpoint

-- 4. Trigger: update searchable_text and sync FTS on UPDATE OF data
CREATE TRIGGER IF NOT EXISTS message_au AFTER UPDATE OF data ON message BEGIN
  -- Remove old FTS entry
  INSERT INTO message_fts(message_fts, rowid, searchable_text)
  VALUES ('delete', OLD.rowid, OLD.searchable_text);
  -- Update searchable_text
  UPDATE message SET searchable_text = (
    SELECT group_concat(json_extract(value, '$.content'), ' ')
    FROM json_each(json_extract(NEW.data, '$.blocks'))
    WHERE json_extract(value, '$.type') = 'main_text'
  ) WHERE id = NEW.id;
  -- Add new FTS entry
  INSERT INTO message_fts(rowid, searchable_text)
  SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
END;
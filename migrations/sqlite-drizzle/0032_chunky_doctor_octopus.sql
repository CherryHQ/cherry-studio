PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_external_knowledge_document` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`remote_object_id` text NOT NULL,
	`title` text NOT NULL,
	`original_url` text NOT NULL,
	`remote_revision` text,
	`content_hash` text,
	`last_seen_at` integer NOT NULL,
	`availability` text NOT NULL,
	`knowledge_item_id` text,
	`current_warning` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `external_knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_item_id`) REFERENCES `knowledge_item`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "external_knowledge_document_availability_check" CHECK("__new_external_knowledge_document"."availability" IN ('active', 'unavailable')),
	CONSTRAINT "external_knowledge_document_ownership_check" CHECK(("__new_external_knowledge_document"."availability" = 'active' AND "__new_external_knowledge_document"."knowledge_item_id" IS NOT NULL)
          OR ("__new_external_knowledge_document"."availability" = 'unavailable' AND "__new_external_knowledge_document"."knowledge_item_id" IS NULL)),
	CONSTRAINT "external_knowledge_document_identity_nonempty_check" CHECK(length(trim("__new_external_knowledge_document"."remote_object_id")) > 0
          AND length(trim("__new_external_knowledge_document"."title")) > 0
          AND length(trim("__new_external_knowledge_document"."original_url")) > 0
          AND ("__new_external_knowledge_document"."remote_revision" IS NULL OR length(trim("__new_external_knowledge_document"."remote_revision")) > 0)
          AND ("__new_external_knowledge_document"."content_hash" IS NULL OR length(trim("__new_external_knowledge_document"."content_hash")) > 0)
          AND ("__new_external_knowledge_document"."current_warning" IS NULL OR length(trim("__new_external_knowledge_document"."current_warning")) > 0))
);
--> statement-breakpoint
INSERT INTO `__new_external_knowledge_document`("id", "source_id", "remote_object_id", "title", "original_url", "remote_revision", "content_hash", "last_seen_at", "availability", "knowledge_item_id", "current_warning", "created_at", "updated_at") SELECT "id", "source_id", "remote_object_id", "title", "original_url", "remote_revision", "content_hash", "last_seen_at", "availability", "knowledge_item_id", "current_warning", "created_at", "updated_at" FROM `external_knowledge_document`;--> statement-breakpoint
DROP TABLE `external_knowledge_document`;--> statement-breakpoint
ALTER TABLE `__new_external_knowledge_document` RENAME TO `external_knowledge_document`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_document_source_remote_object_uq` ON `external_knowledge_document` (`source_id`,`remote_object_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_document_knowledge_item_uq` ON `external_knowledge_document` (`knowledge_item_id`);--> statement-breakpoint
CREATE INDEX `external_knowledge_document_source_availability_idx` ON `external_knowledge_document` (`source_id`,`availability`);--> statement-breakpoint
CREATE TABLE `__new_external_knowledge_source` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`tenant_id` text NOT NULL,
	`space_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`schedule_id` text,
	`revision` integer NOT NULL,
	`active_job_id` text,
	`last_trigger` text,
	`last_started_at` integer,
	`last_finished_at` integer,
	`last_outcome` text,
	`last_indexed_count` integer,
	`last_unchanged_count` integer,
	`last_skipped_count` integer,
	`last_warning_count` integer,
	`last_error_summary` text,
	`last_successful_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `external_knowledge_connection`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`schedule_id`) REFERENCES `job_schedule`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "external_knowledge_source_provider_check" CHECK("__new_external_knowledge_source"."provider" = 'feishu'),
	CONSTRAINT "external_knowledge_source_state_check" CHECK("__new_external_knowledge_source"."state" IN ('active', 'paused')),
	CONSTRAINT "external_knowledge_source_revision_check" CHECK("__new_external_knowledge_source"."revision" >= 0),
	CONSTRAINT "external_knowledge_source_identity_nonempty_check" CHECK(length(trim("__new_external_knowledge_source"."tenant_id")) > 0
          AND length(trim("__new_external_knowledge_source"."space_id")) > 0
          AND length(trim("__new_external_knowledge_source"."name")) > 0),
	CONSTRAINT "external_knowledge_source_scope_check" CHECK(json_valid("__new_external_knowledge_source"."scope")
          AND json_type("__new_external_knowledge_source"."scope") = 'object'
          AND json_extract("__new_external_knowledge_source"."scope", '$.kind') IN ('space', 'node', 'document')
          AND (
            json_extract("__new_external_knowledge_source"."scope", '$.kind') = 'space'
            OR coalesce(length(trim(json_extract("__new_external_knowledge_source"."scope", '$.nodeId'))), 0) > 0
          )
          AND (
            json_extract("__new_external_knowledge_source"."scope", '$.kind') != 'document'
            OR coalesce(length(trim(json_extract("__new_external_knowledge_source"."scope", '$.remoteObjectId'))), 0) > 0
          )),
	CONSTRAINT "external_knowledge_source_last_trigger_check" CHECK("__new_external_knowledge_source"."last_trigger" IS NULL OR "__new_external_knowledge_source"."last_trigger" IN ('initial', 'manual', 'scheduled', 'startup')),
	CONSTRAINT "external_knowledge_source_last_outcome_check" CHECK("__new_external_knowledge_source"."last_outcome" IS NULL OR "__new_external_knowledge_source"."last_outcome" IN ('completed', 'completed-with-warnings', 'failed', 'cancelled')),
	CONSTRAINT "external_knowledge_source_counts_check" CHECK(("__new_external_knowledge_source"."last_indexed_count" IS NULL OR "__new_external_knowledge_source"."last_indexed_count" >= 0)
          AND ("__new_external_knowledge_source"."last_unchanged_count" IS NULL OR "__new_external_knowledge_source"."last_unchanged_count" >= 0)
          AND ("__new_external_knowledge_source"."last_skipped_count" IS NULL OR "__new_external_knowledge_source"."last_skipped_count" >= 0)
          AND ("__new_external_knowledge_source"."last_warning_count" IS NULL OR "__new_external_knowledge_source"."last_warning_count" >= 0)),
	CONSTRAINT "external_knowledge_source_error_nonempty_check" CHECK("__new_external_knowledge_source"."last_error_summary" IS NULL OR length(trim("__new_external_knowledge_source"."last_error_summary")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_external_knowledge_source`("id", "base_id", "connection_id", "provider", "tenant_id", "space_id", "scope", "name", "state", "schedule_id", "revision", "active_job_id", "last_trigger", "last_started_at", "last_finished_at", "last_outcome", "last_indexed_count", "last_unchanged_count", "last_skipped_count", "last_warning_count", "last_error_summary", "last_successful_sync_at", "created_at", "updated_at") SELECT "id", "base_id", "connection_id", "provider", "tenant_id", "space_id", "scope", "name", "state", "schedule_id", "revision", "active_job_id", "last_trigger", "last_started_at", "last_finished_at", "last_outcome", "last_indexed_count", "last_unchanged_count", "last_skipped_count", "last_warning_count", "last_error_summary", "last_successful_sync_at", "created_at", "updated_at" FROM `external_knowledge_source`;--> statement-breakpoint
DROP TABLE `external_knowledge_source`;--> statement-breakpoint
ALTER TABLE `__new_external_knowledge_source` RENAME TO `external_knowledge_source`;--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_source_base_provider_tenant_space_uq` ON `external_knowledge_source` (`base_id`,`provider`,`tenant_id`,`space_id`);--> statement-breakpoint
CREATE INDEX `external_knowledge_source_connection_idx` ON `external_knowledge_source` (`connection_id`);--> statement-breakpoint
CREATE INDEX `external_knowledge_source_schedule_idx` ON `external_knowledge_source` (`schedule_id`);
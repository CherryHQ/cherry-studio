CREATE TABLE `external_knowledge_document` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`remote_object_id` text NOT NULL,
	`canonical_node_id` text NOT NULL,
	`parent_node_id` text,
	`relative_breadcrumb` text NOT NULL,
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
	CONSTRAINT "external_knowledge_document_availability_check" CHECK("external_knowledge_document"."availability" IN ('active', 'unavailable')),
	CONSTRAINT "external_knowledge_document_ownership_check" CHECK(("external_knowledge_document"."availability" = 'active' AND "external_knowledge_document"."knowledge_item_id" IS NOT NULL)
          OR ("external_knowledge_document"."availability" = 'unavailable' AND "external_knowledge_document"."knowledge_item_id" IS NULL)),
	CONSTRAINT "external_knowledge_document_identity_nonempty_check" CHECK(length(trim("external_knowledge_document"."remote_object_id")) > 0
          AND length(trim("external_knowledge_document"."canonical_node_id")) > 0
          AND ("external_knowledge_document"."parent_node_id" IS NULL OR length(trim("external_knowledge_document"."parent_node_id")) > 0)
          AND length(trim("external_knowledge_document"."title")) > 0
          AND length(trim("external_knowledge_document"."original_url")) > 0
          AND ("external_knowledge_document"."remote_revision" IS NULL OR length(trim("external_knowledge_document"."remote_revision")) > 0)
          AND ("external_knowledge_document"."content_hash" IS NULL OR length(trim("external_knowledge_document"."content_hash")) > 0)
          AND ("external_knowledge_document"."current_warning" IS NULL OR length(trim("external_knowledge_document"."current_warning")) > 0)),
	CONSTRAINT "external_knowledge_document_breadcrumb_check" CHECK(json_valid("external_knowledge_document"."relative_breadcrumb") AND json_type("external_knowledge_document"."relative_breadcrumb") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_document_source_remote_object_uq` ON `external_knowledge_document` (`source_id`,`remote_object_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_document_knowledge_item_uq` ON `external_knowledge_document` (`knowledge_item_id`);--> statement-breakpoint
CREATE INDEX `external_knowledge_document_source_availability_idx` ON `external_knowledge_document` (`source_id`,`availability`);--> statement-breakpoint
CREATE TABLE `external_knowledge_source` (
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
	`last_scanned_count` integer,
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
	CONSTRAINT "external_knowledge_source_provider_check" CHECK("external_knowledge_source"."provider" = 'feishu'),
	CONSTRAINT "external_knowledge_source_state_check" CHECK("external_knowledge_source"."state" IN ('active', 'paused')),
	CONSTRAINT "external_knowledge_source_revision_check" CHECK("external_knowledge_source"."revision" >= 0),
	CONSTRAINT "external_knowledge_source_identity_nonempty_check" CHECK(length(trim("external_knowledge_source"."tenant_id")) > 0
          AND length(trim("external_knowledge_source"."space_id")) > 0
          AND length(trim("external_knowledge_source"."name")) > 0),
	CONSTRAINT "external_knowledge_source_scope_check" CHECK(json_valid("external_knowledge_source"."scope")
          AND json_type("external_knowledge_source"."scope") = 'object'
          AND json_extract("external_knowledge_source"."scope", '$.kind') IN ('space', 'node', 'document')
          AND (
            json_extract("external_knowledge_source"."scope", '$.kind') = 'space'
            OR coalesce(length(trim(json_extract("external_knowledge_source"."scope", '$.nodeId'))), 0) > 0
          )
          AND (
            json_extract("external_knowledge_source"."scope", '$.kind') != 'document'
            OR coalesce(length(trim(json_extract("external_knowledge_source"."scope", '$.remoteObjectId'))), 0) > 0
          )),
	CONSTRAINT "external_knowledge_source_last_trigger_check" CHECK("external_knowledge_source"."last_trigger" IS NULL OR "external_knowledge_source"."last_trigger" IN ('initial', 'manual', 'scheduled', 'startup')),
	CONSTRAINT "external_knowledge_source_last_outcome_check" CHECK("external_knowledge_source"."last_outcome" IS NULL OR "external_knowledge_source"."last_outcome" IN ('completed', 'completed-with-warnings', 'failed', 'cancelled')),
	CONSTRAINT "external_knowledge_source_counts_check" CHECK(("external_knowledge_source"."last_scanned_count" IS NULL OR "external_knowledge_source"."last_scanned_count" >= 0)
          AND ("external_knowledge_source"."last_indexed_count" IS NULL OR "external_knowledge_source"."last_indexed_count" >= 0)
          AND ("external_knowledge_source"."last_unchanged_count" IS NULL OR "external_knowledge_source"."last_unchanged_count" >= 0)
          AND ("external_knowledge_source"."last_skipped_count" IS NULL OR "external_knowledge_source"."last_skipped_count" >= 0)
          AND ("external_knowledge_source"."last_warning_count" IS NULL OR "external_knowledge_source"."last_warning_count" >= 0)),
	CONSTRAINT "external_knowledge_source_error_nonempty_check" CHECK("external_knowledge_source"."last_error_summary" IS NULL OR length(trim("external_knowledge_source"."last_error_summary")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_source_base_provider_tenant_space_uq` ON `external_knowledge_source` (`base_id`,`provider`,`tenant_id`,`space_id`);--> statement-breakpoint
CREATE INDEX `external_knowledge_source_connection_idx` ON `external_knowledge_source` (`connection_id`);--> statement-breakpoint
CREATE INDEX `external_knowledge_source_schedule_idx` ON `external_knowledge_source` (`schedule_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("__new_knowledge_item"."type" IN ('file', 'url', 'note', 'directory', 'external')),
	CONSTRAINT "knowledge_item_status_check" CHECK("__new_knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting')),
	CONSTRAINT "knowledge_item_type_status_check" CHECK(
        ("__new_knowledge_item"."type" IN ('file', 'url', 'note', 'external') AND "__new_knowledge_item"."status" IN ('idle', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting'))
        OR ("__new_knowledge_item"."type" = 'directory' AND "__new_knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'completed', 'failed', 'deleting'))
      ),
	CONSTRAINT "knowledge_item_status_error_check" CHECK(
        (
          "__new_knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'deleting')
          AND "__new_knowledge_item"."error" IS NULL
        )
        OR (
          "__new_knowledge_item"."status" = 'failed'
          AND "__new_knowledge_item"."error" IS NOT NULL
          AND length(trim("__new_knowledge_item"."error")) > 0
        )
      )
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_item`("id", "base_id", "group_id", "type", "data", "status", "error", "created_at", "updated_at") SELECT "id", "base_id", "group_id", "type", "data", "status", "error", "created_at", "updated_at" FROM `knowledge_item`;--> statement-breakpoint
DROP TABLE `knowledge_item`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_item` RENAME TO `knowledge_item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);
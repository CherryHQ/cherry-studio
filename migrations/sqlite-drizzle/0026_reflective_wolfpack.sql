CREATE TABLE `external_knowledge_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`app_id` text NOT NULL,
	`app_credential_source` text NOT NULL,
	`authorization_status` text NOT NULL,
	`credential_reference` text NOT NULL,
	`account_user_id` text,
	`account_open_id` text,
	`account_union_id` text,
	`tenant_key` text,
	`display_name` text,
	`avatar_url` text,
	`application_name` text,
	`granted_scopes` text DEFAULT '[]' NOT NULL,
	`authorized_at` integer,
	`last_validated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "external_knowledge_connection_provider_check" CHECK("external_knowledge_connection"."provider" = 'feishu'),
	CONSTRAINT "external_knowledge_connection_app_credential_source_check" CHECK("external_knowledge_connection"."app_credential_source" IN ('personal-agent', 'custom-app')),
	CONSTRAINT "external_knowledge_connection_authorization_status_check" CHECK("external_knowledge_connection"."authorization_status" IN ('pending-authorization', 'connected', 'reauthorization-required')),
	CONSTRAINT "external_knowledge_connection_app_id_nonempty_check" CHECK(length(trim("external_knowledge_connection"."app_id")) > 0),
	CONSTRAINT "external_knowledge_connection_credential_reference_nonempty_check" CHECK(length(trim("external_knowledge_connection"."credential_reference")) > 0),
	CONSTRAINT "external_knowledge_connection_identity_nonempty_check" CHECK(("external_knowledge_connection"."account_user_id" IS NULL OR length(trim("external_knowledge_connection"."account_user_id")) > 0)
          AND ("external_knowledge_connection"."account_open_id" IS NULL OR length(trim("external_knowledge_connection"."account_open_id")) > 0)
          AND ("external_knowledge_connection"."account_union_id" IS NULL OR length(trim("external_knowledge_connection"."account_union_id")) > 0)
          AND ("external_knowledge_connection"."tenant_key" IS NULL OR length(trim("external_knowledge_connection"."tenant_key")) > 0)),
	CONSTRAINT "external_knowledge_connection_display_nonempty_check" CHECK(("external_knowledge_connection"."display_name" IS NULL OR length(trim("external_knowledge_connection"."display_name")) > 0)
          AND ("external_knowledge_connection"."avatar_url" IS NULL OR length(trim("external_knowledge_connection"."avatar_url")) > 0)
          AND ("external_knowledge_connection"."application_name" IS NULL OR length(trim("external_knowledge_connection"."application_name")) > 0)),
	CONSTRAINT "external_knowledge_connection_granted_scopes_json_check" CHECK(json_valid("external_knowledge_connection"."granted_scopes") AND json_type("external_knowledge_connection"."granted_scopes") = 'array'),
	CONSTRAINT "external_knowledge_connection_connected_identity_check" CHECK("external_knowledge_connection"."authorization_status" != 'connected' OR (
        "external_knowledge_connection"."account_user_id" IS NOT NULL
        AND "external_knowledge_connection"."account_open_id" IS NOT NULL
        AND "external_knowledge_connection"."tenant_key" IS NOT NULL
        AND "external_knowledge_connection"."authorized_at" IS NOT NULL
        AND json_array_length("external_knowledge_connection"."granted_scopes") > 0
      )),
	CONSTRAINT "external_knowledge_connection_pending_identity_check" CHECK("external_knowledge_connection"."authorization_status" != 'pending-authorization' OR (
        "external_knowledge_connection"."account_user_id" IS NULL
        AND "external_knowledge_connection"."account_open_id" IS NULL
        AND "external_knowledge_connection"."account_union_id" IS NULL
        AND "external_knowledge_connection"."tenant_key" IS NULL
        AND "external_knowledge_connection"."display_name" IS NULL
        AND "external_knowledge_connection"."avatar_url" IS NULL
        AND "external_knowledge_connection"."authorized_at" IS NULL
        AND "external_knowledge_connection"."last_validated_at" IS NULL
        AND json_array_length("external_knowledge_connection"."granted_scopes") = 0
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_knowledge_connection_credential_reference_unique_idx` ON `external_knowledge_connection` (`credential_reference`);
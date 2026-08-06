CREATE TABLE `agent_session_message_file_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`file_entry_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_entry_id`) REFERENCES `file_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `agent_session_message`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asmfr_role_check" CHECK("agent_session_message_file_ref"."role" IN ('attachment'))
);
--> statement-breakpoint
CREATE INDEX `asmfr_entry_id_idx` ON `agent_session_message_file_ref` (`file_entry_id`);--> statement-breakpoint
CREATE INDEX `asmfr_source_id_idx` ON `agent_session_message_file_ref` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `asmfr_unique_idx` ON `agent_session_message_file_ref` (`file_entry_id`,`source_id`,`role`);--> statement-breakpoint
INSERT INTO `agent_session_message_file_ref` (`id`, `file_entry_id`, `source_id`, `role`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	json_extract(part.value, '$.providerMetadata.cherry.fileEntryId'),
	message.id,
	'attachment',
	message.created_at,
	message.updated_at
FROM `agent_session_message` AS message
JOIN json_each(json_extract(message.data, '$.parts')) AS part
JOIN `file_entry` AS file ON file.id = json_extract(part.value, '$.providerMetadata.cherry.fileEntryId')
WHERE json_extract(part.value, '$.type') = 'file'
GROUP BY message.id, json_extract(part.value, '$.providerMetadata.cherry.fileEntryId');
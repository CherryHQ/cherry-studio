CREATE TABLE `agent_session_message_part` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`pos` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `agent_session_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_part_message_seq_uniq` ON `agent_session_message_part` (`message_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_session_message_part_session_idx` ON `agent_session_message_part` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_part_pos_uniq` ON `agent_session_message_part` (`session_id`,`pos`);--> statement-breakpoint
CREATE TABLE `agent_session_tool_output` (
	`message_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`session_id` text NOT NULL,
	`output` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `tool_call_id`),
	FOREIGN KEY (`message_id`) REFERENCES `agent_session_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_session_tool_output_session_idx` ON `agent_session_tool_output` (`session_id`);--> statement-breakpoint
CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`session_id` text,
	`topic_id` text,
	`path` text,
	`file_entry_id` text,
	`title` text NOT NULL,
	`size` integer,
	`reported_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_owner_check" CHECK(("artifact"."agent_id" IS NOT NULL AND "artifact"."session_id" IS NOT NULL AND "artifact"."topic_id" IS NULL AND "artifact"."path" IS NOT NULL AND "artifact"."file_entry_id" IS NULL) OR ("artifact"."agent_id" IS NULL AND "artifact"."session_id" IS NULL AND "artifact"."topic_id" IS NOT NULL AND "artifact"."path" IS NULL AND "artifact"."file_entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_session_path_uq` ON `artifact` (`session_id`,`path`);--> statement-breakpoint
CREATE INDEX `artifact_agent_reported_idx` ON `artifact` (`agent_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `artifact_topic_idx` ON `artifact` (`topic_id`);--> statement-breakpoint
CREATE INDEX `artifact_file_entry_idx` ON `artifact` (`file_entry_id`);--> statement-breakpoint
ALTER TABLE `agent_runtime_backend` ADD `needs_recovery_check` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_runtime_backend_recovery_idx` ON `agent_runtime_backend` (`id`) WHERE "agent_runtime_backend"."needs_recovery_check" = 1;--> statement-breakpoint
ALTER TABLE `agent_session` ADD `last_pos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `pos` integer;--> statement-breakpoint
CREATE INDEX `agent_session_message_reply_idx` ON `agent_session_message` (`session_id`,`reply_id`) WHERE "agent_session_message"."reply_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_session_message_pending_reply_idx` ON `agent_session_message` (`session_id`) WHERE "agent_session_message"."role" = 'assistant' AND "agent_session_message"."status" = 'pending';--> statement-breakpoint
ALTER TABLE `mcp_server` ADD `skill_permissions` text;
--> statement-breakpoint
CREATE TEMP TABLE `agent_session_timeline_positions` (
  `session_id` text NOT NULL,
  `message_id` text NOT NULL,
  `seq` integer NOT NULL,
  `pos` integer NOT NULL,
  PRIMARY KEY (`message_id`, `seq`)
) WITHOUT ROWID;
--> statement-breakpoint
WITH RECURSIVE lineage(id, session_id, depth) AS (
  SELECT id, session_id, 0 FROM agent_session_message WHERE role = 'root'
  UNION ALL
  SELECT child.id, child.session_id, lineage.depth + 1
  FROM lineage JOIN agent_session_message AS child
    ON child.session_id = lineage.session_id AND child.parent_id = lineage.id
), items AS (
  SELECT m.session_id, m.id AS message_id, m.created_at, lineage.depth, -1 AS seq
  FROM lineage JOIN agent_session_message AS m ON m.id = lineage.id
  WHERE m.role = 'user'
  UNION ALL
  SELECT m.session_id, m.id, m.created_at, lineage.depth, p.key
  FROM lineage JOIN agent_session_message AS m ON m.id = lineage.id
  CROSS JOIN json_each(m.data, '$.parts') AS p
  WHERE m.role = 'assistant'
)
INSERT INTO agent_session_timeline_positions (session_id, message_id, seq, pos)
SELECT session_id, message_id, seq,
  row_number() OVER (PARTITION BY session_id ORDER BY depth, created_at, message_id, seq)
FROM items;
--> statement-breakpoint
CREATE TEMP TABLE agent_session_legacy_tool_outputs (
  message_id text NOT NULL,
  seq integer NOT NULL,
  tool_call_id text NOT NULL,
  state text NOT NULL,
  archive_metadata integer NOT NULL,
  PRIMARY KEY (message_id, seq)
) WITHOUT ROWID;
--> statement-breakpoint
-- The sidecar is keyed by call ID. Keep ambiguous calls and structured previews on their original read path.
WITH tool_parts AS MATERIALIZED (
  SELECT message.id AS message_id, part.key AS seq,
    json_extract(message.data, part.fullkey || '.toolCallId') AS tool_call_id,
    json_extract(message.data, part.fullkey || '.state') AS state,
    json_type(message.data, part.fullkey || '.resultProviderMetadata') = 'object' AS has_metadata,
    CASE json_extract(message.data, part.fullkey || '.state')
      WHEN 'output-available' THEN
        json_type(message.data, part.fullkey || '.output.$deferredToolResult') IS NULL
        AND json_type(message.data, part.fullkey || '.output.$persistedToolOutput') IS NULL
        AND json_type(message.data, part.fullkey || '.output.metadata.app') IS NULL
        AND json_type(message.data, part.fullkey || '.output.conceptId') IS NULL
        AND json_type(message.data, part.fullkey || '.output[0].id') IS NULL
        AND coalesce(json_extract(message.data, part.fullkey || '.output.metadata.serverId'), '') != 'cherry-tools'
        AND coalesce(json_extract(message.data, part.fullkey || '.output.metadata.serverName'), '') != 'cherry-tools'
        AND octet_length(message.data -> (part.fullkey || '.output')) > 32768
      WHEN 'output-error' THEN
        json_type(message.data, part.fullkey || '.resultProviderMetadata.cherry.deferredToolOutput') IS NULL
        AND octet_length(json_extract(message.data, part.fullkey || '.errorText')) > 32768
    END AS should_archive
  FROM agent_session_message AS message
  CROSS JOIN jsonb_each(message.data, '$.parts') AS part
  WHERE octet_length(message.data) > 32768
    AND typeof(part.key) = 'integer'
    AND (json_extract(message.data, part.fullkey || '.type') = 'dynamic-tool' OR json_extract(message.data, part.fullkey || '.type') GLOB 'tool-*')
), candidates AS (
  SELECT *, count(*) OVER (PARTITION BY message_id, tool_call_id) AS call_count
  FROM tool_parts
)
INSERT INTO agent_session_legacy_tool_outputs (message_id, seq, tool_call_id, state, archive_metadata)
SELECT candidate.message_id, candidate.seq, candidate.tool_call_id, candidate.state, coalesce(candidate.has_metadata, 0)
FROM candidates AS candidate
WHERE candidate.should_archive AND candidate.call_count = 1 AND candidate.tool_call_id != '';
--> statement-breakpoint
WITH tool_sources AS (
  SELECT message.id, message.session_id, message.data, message.created_at, message.updated_at,
    archived.tool_call_id, archived.state, archived.archive_metadata, '$.parts[' || archived.seq || ']' AS path
  FROM agent_session_legacy_tool_outputs AS archived
  JOIN agent_session_message AS message ON message.id = archived.message_id
)
INSERT INTO agent_session_tool_output (message_id, tool_call_id, session_id, output, created_at, updated_at)
SELECT id, tool_call_id, session_id,
  CASE
    WHEN state = 'output-error' AND archive_metadata THEN
      json_object('isError', json('true'), 'content', json_array(json_object('type', 'text', 'text', data ->> (path || '.errorText'))),
        'resultProviderMetadata', data -> (path || '.resultProviderMetadata'))
    WHEN state = 'output-error' THEN
      json_object('isError', json('true'), 'content', json_array(json_object('type', 'text', 'text', data ->> (path || '.errorText'))))
    WHEN archive_metadata THEN
      json_object('output', data -> (path || '.output'), 'resultProviderMetadata', data -> (path || '.resultProviderMetadata'))
    ELSE data -> (path || '.output')
  END,
  created_at, updated_at
FROM tool_sources;
--> statement-breakpoint
-- The old trigger recomputes searchable_text from `data.parts`; drop it before the body moves out.
-- Boot custom SQL recreates the FTS triggers against the new contract.
DROP TRIGGER IF EXISTS `agent_session_message_au`;--> statement-breakpoint
INSERT INTO `agent_session_message_part` (`id`, `message_id`, `session_id`, `seq`, `type`, `payload`, `created_at`, `updated_at`, `pos`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
		substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`message`.`id`,
	`message`.`session_id`,
	`part`.`key`,
	coalesce(json_extract(`part`.`value`, '$.type'), ''),
	CASE WHEN archived.tool_call_id IS NULL THEN
    CASE WHEN part.type IN ('object', 'array') THEN json(part.value) ELSE part.value END
    WHEN archived.state = 'output-error' THEN json_set(json_remove(part.value, '$.errorText', '$.resultProviderMetadata'),
      '$.errorText', substr(json_extract(part.value, '$.errorText'), 1, 511) || '…',
      '$.resultProviderMetadata', json_object('cherry', json_object('deferredToolOutput', json_object(
        '$deferredToolResult', json_object('topicId', 'agent-session:' || message.session_id, 'messageId', message.id, 'toolCallId', archived.tool_call_id)
      )))
    )
    ELSE json_set(json_remove(part.value, '$.output', '$.resultProviderMetadata'), '$.output', json_patch(
      json_object('$deferredToolResult', json_object('topicId', 'agent-session:' || message.session_id, 'messageId', message.id, 'toolCallId', archived.tool_call_id)),
      CASE WHEN archived.archive_metadata THEN '{"archivedProviderMetadata":true}' ELSE '{}' END
    ))
  END,
	`message`.`created_at`,
	`message`.`updated_at`,
	placement.pos
FROM `agent_session_message` AS `message`
CROSS JOIN jsonb_each(`message`.`data`, '$.parts') AS `part`
LEFT JOIN agent_session_timeline_positions AS placement
  ON placement.message_id = message.id AND placement.seq = part.key
LEFT JOIN agent_session_legacy_tool_outputs AS archived
  ON archived.message_id = message.id AND archived.seq = part.key;
--> statement-breakpoint
DROP TABLE agent_session_legacy_tool_outputs;
--> statement-breakpoint
UPDATE `agent_session_message` SET `data` = json_remove(`data`, '$.parts') WHERE json_type(`data`, '$.parts') IS NOT NULL;
--> statement-breakpoint
UPDATE agent_session_message AS message SET pos = placement.pos
FROM agent_session_timeline_positions AS placement
WHERE placement.seq = -1 AND placement.message_id = message.id;
--> statement-breakpoint
UPDATE agent_session AS session SET last_pos = placement.max_pos
FROM (SELECT session_id, max(pos) AS max_pos FROM agent_session_timeline_positions GROUP BY session_id) AS placement
WHERE placement.session_id = session.id;
--> statement-breakpoint
DROP TABLE agent_session_timeline_positions;
--> statement-breakpoint
UPDATE `agent_runtime_backend` SET `needs_recovery_check` = 1 WHERE `state` = 'bound' AND json_extract(`locator`, '$.kind') = 'pi-durable';

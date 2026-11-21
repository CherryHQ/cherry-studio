ALTER TABLE `agent_session` ADD `last_pos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_session_message_part` ADD `pos` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_part_pos_uniq` ON `agent_session_message_part` (`session_id`,`pos`);--> statement-breakpoint
ALTER TABLE `agent_session_message` ADD `pos` integer;
--> statement-breakpoint
CREATE TEMP TABLE `agent_session_timeline_positions` (
  `session_id` text NOT NULL,
  `kind` text NOT NULL,
  `item_id` text NOT NULL,
  `pos` integer NOT NULL,
  PRIMARY KEY (`kind`, `item_id`)
) WITHOUT ROWID;
--> statement-breakpoint
WITH RECURSIVE lineage(id, session_id, depth) AS (
  SELECT id, session_id, 0 FROM agent_session_message WHERE role = 'root'
  UNION ALL
  SELECT child.id, child.session_id, lineage.depth + 1
  FROM lineage JOIN agent_session_message AS child
    ON child.session_id = lineage.session_id AND child.parent_id = lineage.id
), items AS (
  SELECT m.session_id, 'input' AS kind, m.id AS item_id, m.id AS owner, m.created_at, lineage.depth, -1 AS seq
  FROM lineage JOIN agent_session_message AS m ON m.id = lineage.id
  WHERE m.role = 'user'
  UNION ALL
  SELECT m.session_id, 'part', p.id, m.id, m.created_at, lineage.depth, p.seq
  FROM lineage JOIN agent_session_message AS m ON m.id = lineage.id
  JOIN agent_session_message_part AS p ON p.message_id = m.id
  WHERE m.role = 'assistant'
)
INSERT INTO agent_session_timeline_positions (session_id, kind, item_id, pos)
SELECT session_id, kind, item_id,
  row_number() OVER (PARTITION BY session_id ORDER BY depth, created_at, owner, seq, item_id)
FROM items;
--> statement-breakpoint
UPDATE agent_session_message AS message SET pos = placement.pos
FROM agent_session_timeline_positions AS placement
WHERE placement.kind = 'input' AND placement.item_id = message.id;
--> statement-breakpoint
UPDATE agent_session_message_part AS part SET pos = placement.pos
FROM agent_session_timeline_positions AS placement
WHERE placement.kind = 'part' AND placement.item_id = part.id;
--> statement-breakpoint
UPDATE agent_session AS session SET last_pos = placement.max_pos
FROM (SELECT session_id, max(pos) AS max_pos FROM agent_session_timeline_positions GROUP BY session_id) AS placement
WHERE placement.session_id = session.id;
--> statement-breakpoint
DROP TABLE agent_session_timeline_positions;

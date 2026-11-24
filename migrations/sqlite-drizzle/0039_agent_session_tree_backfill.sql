DROP TRIGGER IF EXISTS agent_session_message_ai;
--> statement-breakpoint
-- Only untouched flat archives have no selected head and no parent edges.
CREATE TEMP TABLE agent_session_flat_archive AS
SELECT s.id FROM agent_session s
WHERE s.active_node_id IS NULL AND NOT EXISTS (
  SELECT 1 FROM agent_session_message m WHERE m.session_id = s.id AND m.parent_id IS NOT NULL
);
--> statement-breakpoint
INSERT INTO agent_session_message (id, session_id, role, data, status, fts_rowid, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  s.id, 'root', '{"parts":[]}', 'success',
  (SELECT coalesce(max(fts_rowid), 0) FROM agent_session_message) + row_number() OVER (ORDER BY s.id),
  s.created_at, s.updated_at
FROM agent_session s JOIN agent_session_flat_archive f ON f.id = s.id
WHERE NOT EXISTS (SELECT 1 FROM agent_session_message m WHERE m.session_id = s.id AND m.role = 'root');
--> statement-breakpoint
WITH ordered AS (
  SELECT m.id, lag(m.id, 1, r.id) OVER (PARTITION BY m.session_id ORDER BY m.created_at, m.id) AS parent_id
  FROM agent_session_message m
  JOIN agent_session_flat_archive f ON f.id = m.session_id
  JOIN agent_session_message r ON r.session_id = m.session_id AND r.role = 'root'
  WHERE m.role != 'root'
)
UPDATE agent_session_message SET parent_id = ordered.parent_id FROM ordered WHERE agent_session_message.id = ordered.id;
--> statement-breakpoint
UPDATE agent_session SET active_node_id = coalesce(
  (SELECT id FROM agent_session_message WHERE session_id = agent_session.id AND role != 'root' ORDER BY created_at DESC, id DESC LIMIT 1),
  (SELECT id FROM agent_session_message WHERE session_id = agent_session.id AND role = 'root')
) WHERE id IN (SELECT id FROM agent_session_flat_archive);
--> statement-breakpoint
DROP TABLE agent_session_flat_archive;
--> statement-breakpoint
-- Foreign keys are disabled during table rebuilds; reject invalid existing edges before copying.
CREATE TEMP TABLE agent_session_tree_integrity (invalid_count INTEGER CHECK (invalid_count = 0));
--> statement-breakpoint
INSERT INTO agent_session_tree_integrity
SELECT count(*) FROM agent_session_message m
WHERE (m.role = 'root') != (m.parent_id IS NULL)
OR (m.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM agent_session_message p WHERE p.id = m.parent_id AND p.session_id = m.session_id
));
--> statement-breakpoint
DROP TABLE agent_session_tree_integrity;
--> statement-breakpoint
-- Fresh databases have not replayed custom SQL yet; upgrades must also index the new empty roots.
CREATE VIRTUAL TABLE IF NOT EXISTS agent_session_message_fts USING fts5(
  searchable_text,
  content='agent_session_message',
  content_rowid='fts_rowid',
  tokenize='trigram'
);
--> statement-breakpoint
INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild');

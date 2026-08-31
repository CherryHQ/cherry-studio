-- Privacy backfill: drop model reasoning (hidden chain-of-thought) from the agent session
-- message search index. The INSERT/UPDATE triggers (schemas/agentSessionMessage.ts, replayed by
-- customSqls) are corrected to index only `text` parts, but that only covers future writes;
-- existing rows keep reasoning text in their `searchable_text` column and in the FTS index, which
-- global-search snippets render verbatim. Recompute searchable_text from `text` parts only. This
-- is an UPDATE OF searchable_text, so the `AFTER UPDATE OF data` trigger does not fire; the
-- expression mirrors the corrected trigger body exactly.
UPDATE `agent_session_message` SET `searchable_text` = COALESCE((
  SELECT group_concat(json_extract(value, '$.text'), char(10))
  FROM json_each(json_extract(`data`, '$.parts'))
  WHERE json_extract(value, '$.type') = 'text'
), '');
--> statement-breakpoint
-- Ensure the external-content FTS table exists before rebuilding. On existing databases it was
-- already created by customSqls on a prior boot; on a fresh install this migration runs before
-- customSqls, so guard with IF NOT EXISTS (the rebuild below is then a no-op over empty content).
-- customSqls (schemas/agentSessionMessage.ts) remains the canonical owner of this DDL.
CREATE VIRTUAL TABLE IF NOT EXISTS `agent_session_message_fts` USING fts5(
  searchable_text,
  content='agent_session_message',
  content_rowid='fts_rowid',
  tokenize='trigram'
);
--> statement-breakpoint
-- Rebuild the FTS index from the corrected searchable_text so previously indexed reasoning tokens
-- no longer match.
INSERT INTO `agent_session_message_fts`(`agent_session_message_fts`) VALUES ('rebuild');

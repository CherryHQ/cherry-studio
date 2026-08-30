-- v2.0.0-rc.1 completed the one-shot file migration before cleanup_policy
-- existed. Migration 0003 therefore assigned those historical entries the
-- conservative `manual` default, but their already-created ref rows prove that
-- the chat/painting/logo migrators would have classified them as
-- `delete_when_unreferenced` on a fresh migration.
--
-- Keep the backfill deliberately narrow:
--   * only rows that existed when this database completed its one-shot v2
--     migration (the per-database provenance boundary);
--   * only rows still carrying its `manual` default; and
--   * only rows held by ref types populated by the one-shot v1 migrators.
-- This avoids demoting files that a user explicitly made manual after the
-- cleanup-policy rollout.
UPDATE `file_entry`
SET `cleanup_policy` = 'delete_when_unreferenced'
WHERE `cleanup_policy` = 'manual'
  AND `created_at` <= (
    SELECT CAST(json_extract(`value`, '$.completedAt') AS INTEGER)
    FROM `app_state`
    WHERE `key` = 'migration_v2_status'
  )
  AND `id` IN (
    SELECT `file_entry_id` FROM `agent_session_message_file_ref`
    UNION
    SELECT `file_entry_id` FROM `chat_message_file_ref`
    UNION
    SELECT `file_entry_id` FROM `painting_file_ref`
    UNION
    SELECT `file_entry_id` FROM `provider_logo_file_ref`
    UNION
    SELECT `file_entry_id` FROM `mini_app_logo_file_ref`
  );

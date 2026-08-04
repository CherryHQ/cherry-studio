-- Repair the v1→v2 migration bug where a regenerated assistant response could
-- point to a later user message while that user message pointed back to the
-- selected response. Reattach only the user side of the exact two-node pattern
-- to the nearest earlier root-reachable message, falling back to the topic root.
WITH RECURSIVE reachable(id) AS (
  SELECT id
  FROM message
  WHERE parent_id IS NULL AND deleted_at IS NULL

  UNION

  SELECT child.id
  FROM message child
  INNER JOIN reachable parent ON child.parent_id = parent.id
  WHERE child.deleted_at IS NULL
),
cyclic_users(id) AS (
  SELECT user_message.id
  FROM message user_message
  INNER JOIN message assistant_message
    ON assistant_message.id = user_message.parent_id
    AND assistant_message.topic_id = user_message.topic_id
    AND assistant_message.parent_id = user_message.id
  WHERE user_message.role = 'user'
    AND assistant_message.role = 'assistant'
    AND user_message.deleted_at IS NULL
    AND assistant_message.deleted_at IS NULL
)
UPDATE message
SET parent_id = COALESCE(
  (
    SELECT previous.id
    FROM message previous
    INNER JOIN reachable ON reachable.id = previous.id
    WHERE previous.topic_id = message.topic_id
      AND previous.role != 'root'
      AND previous.deleted_at IS NULL
      AND previous.created_at < message.created_at
    ORDER BY previous.created_at DESC, previous.id DESC
    LIMIT 1
  ),
  (
    SELECT root.id
    FROM message root
    WHERE root.topic_id = message.topic_id
      AND root.role = 'root'
      AND root.parent_id IS NULL
      AND root.deleted_at IS NULL
    LIMIT 1
  )
)
WHERE id IN (SELECT id FROM cyclic_users);

WITH RECURSIVE sessions_without_head(id) AS (
  SELECT s.id FROM agent_session s
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_session_message head WHERE head.id = s.active_node_id AND head.session_id = s.id
  )
), reachable(id, session_id, created_at) AS (
  SELECT m.id, m.session_id, m.created_at
  FROM agent_session_message m
  JOIN sessions_without_head s ON s.id = m.session_id
  WHERE m.role = 'root'
  UNION ALL
  SELECT child.id, child.session_id, child.created_at
  FROM reachable r
  JOIN agent_session_message child ON child.session_id = r.session_id AND child.parent_id = r.id
), ranked_leaves(session_id, id, rank) AS (
  SELECT r.session_id, r.id, row_number() OVER (PARTITION BY r.session_id ORDER BY r.created_at DESC, r.id DESC)
  FROM reachable r
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_session_message child WHERE child.session_id = r.session_id AND child.parent_id = r.id
  )
)
UPDATE agent_session AS s SET active_node_id = leaf.id
FROM ranked_leaves leaf
WHERE s.id = leaf.session_id AND leaf.rank = 1;

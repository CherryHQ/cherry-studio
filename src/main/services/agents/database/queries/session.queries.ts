/**
 * SQL queries for Session operations
 */

export const SessionQueries = {
  // Session operations
  insert: `
    INSERT INTO sessions (id, name, main_agent_id, sub_agent_ids, user_goal, status, external_session_id, model, plan_model, small_model, built_in_tools, mcps, knowledges, configuration, accessible_paths, permission_mode, max_steps, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  update: `
    UPDATE sessions
    SET name = ?, main_agent_id = ?, sub_agent_ids = ?, user_goal = ?, status = ?, external_session_id = ?, model = ?, plan_model = ?, small_model = ?, built_in_tools = ?, mcps = ?, knowledges = ?, configuration = ?, accessible_paths = ?, permission_mode = ?, max_steps = ?, updated_at = ?
    WHERE id = ?
  `,

  updateStatus: `
    UPDATE sessions
    SET status = ?, updated_at = ?
    WHERE id = ?
  `,

  getById: `
    SELECT * FROM sessions
    WHERE id = ?
  `,

  list: `
    SELECT * FROM sessions
    ORDER BY created_at DESC
  `,

  listWithLimit: `
    SELECT * FROM sessions
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `,

  count: 'SELECT COUNT(*) as total FROM sessions',

  delete: 'DELETE FROM sessions WHERE id = ?',

  checkExists: 'SELECT id FROM sessions WHERE id = ?',

  getByStatus: `
    SELECT * FROM sessions
    WHERE status = ?
    ORDER BY created_at DESC
  `,

  updateExternalSessionId: `
    UPDATE sessions
    SET external_session_id = ?, updated_at = ?
    WHERE id = ?
  `,

  getSessionWithAgent: `
    SELECT
      s.*,
      a.name as agent_name,
      a.description as agent_description,
      a.avatar as agent_avatar,
      a.instructions as agent_instructions,
      -- Use session configuration if provided, otherwise fall back to agent defaults
      COALESCE(s.model, a.model) as effective_model,
      COALESCE(s.plan_model, a.plan_model) as effective_plan_model,
      COALESCE(s.small_model, a.small_model) as effective_small_model,
      COALESCE(s.built_in_tools, a.built_in_tools) as effective_built_in_tools,
      COALESCE(s.mcps, a.mcps) as effective_mcps,
      COALESCE(s.knowledges, a.knowledges) as effective_knowledges,
      COALESCE(s.configuration, a.configuration) as effective_configuration,
      COALESCE(s.accessible_paths, a.accessible_paths) as effective_accessible_paths,
      COALESCE(s.permission_mode, a.permission_mode) as effective_permission_mode,
      COALESCE(s.max_steps, a.max_steps) as effective_max_steps,
      a.created_at as agent_created_at,
      a.updated_at as agent_updated_at
    FROM sessions s
    LEFT JOIN agents a ON s.main_agent_id = a.id
    WHERE s.id = ?
  `,

  getByExternalSessionId: `
    SELECT * FROM sessions
    WHERE external_session_id = ?
  `
} as const

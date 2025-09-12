/**
 * SQL queries for Agent operations
 */

export const AgentQueries = {
  // Agent operations
  insert: `
    INSERT INTO agents (id, type, name, description, avatar, instructions, model, plan_model, small_model, built_in_tools, mcps, knowledges, configuration, accessible_paths, permission_mode, max_steps, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  update: `
    UPDATE agents
    SET name = ?, description = ?, avatar = ?, instructions = ?, model = ?, plan_model = ?, small_model = ?, built_in_tools = ?, mcps = ?, knowledges = ?, configuration = ?, accessible_paths = ?, permission_mode = ?, max_steps = ?, updated_at = ?
    WHERE id = ?
  `,

  getById: `
    SELECT * FROM agents
    WHERE id = ?
  `,

  list: `
    SELECT * FROM agents
    ORDER BY created_at DESC
  `,

  count: 'SELECT COUNT(*) as total FROM agents',

  delete: 'DELETE FROM agents WHERE id = ?',

  checkExists: 'SELECT id FROM agents WHERE id = ?'
} as const

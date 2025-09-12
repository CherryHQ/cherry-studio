/**
 * SQL queries for AgentService
 */

export const AgentQueries = {
  // Table creation queries
  createTables: {
    agents: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'custom', -- 'claudeCode', 'codex', 'custom'
        name TEXT NOT NULL,
        description TEXT,
        avatar TEXT,
        instructions TEXT,
        model TEXT NOT NULL, -- Main model ID (required)
        plan_model TEXT, -- Optional plan/thinking model ID
        small_model TEXT, -- Optional small/fast model ID
        built_in_tools TEXT, -- JSON array of built-in tool IDs
        mcps TEXT, -- JSON array of MCP tool IDs
        knowledges TEXT, -- JSON array of enabled knowledge base IDs
        configuration TEXT, -- JSON, extensible settings like temperature, top_p
        accessible_paths TEXT, -- JSON array of directory paths the agent can access
        permission_mode TEXT DEFAULT 'readOnly', -- 'readOnly', 'acceptEdits', 'bypassPermissions'
        max_steps INTEGER DEFAULT 10, -- Maximum number of steps the agent can take
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,

    sessions: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT, -- Session name
        main_agent_id TEXT NOT NULL, -- Primary agent ID for the session
        sub_agent_ids TEXT, -- JSON array of sub-agent IDs involved in the session
        user_goal TEXT, -- Initial user goal for the session
        status TEXT NOT NULL DEFAULT 'idle', -- 'idle', 'running', 'completed', 'failed', 'stopped'
        external_session_id TEXT, -- Agent session for external agent management/tracking
        -- AgentConfiguration fields that can override agent defaults
        model TEXT, -- Main model ID (inherits from agent if null)
        plan_model TEXT, -- Optional plan/thinking model ID
        small_model TEXT, -- Optional small/fast model ID
        built_in_tools TEXT, -- JSON array of built-in tool IDs
        mcps TEXT, -- JSON array of MCP tool IDs
        knowledges TEXT, -- JSON array of enabled knowledge base IDs
        configuration TEXT, -- JSON, extensible settings like temperature, top_p
        accessible_paths TEXT, -- JSON array of directory paths the agent can access
        permission_mode TEXT DEFAULT 'readOnly', -- 'readOnly', 'acceptEdits', 'bypassPermissions'
        max_steps INTEGER DEFAULT 10, -- Maximum number of steps the agent can take
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,

    sessionLogs: `
      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        parent_id INTEGER, -- Foreign Key to session_logs.id, nullable for tree structure
        role TEXT NOT NULL, -- 'user', 'agent', 'system', 'tool'
        type TEXT NOT NULL, -- 'message', 'thought', 'action', 'observation', etc.
        content TEXT NOT NULL, -- JSON structured data
        metadata TEXT, -- JSON metadata (optional)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES session_logs (id)
      )
    `
  },

  // Index creation queries
  createIndexes: {
    agentsName: 'CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)',
    agentsType: 'CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type)',
    agentsModel: 'CREATE INDEX IF NOT EXISTS idx_agents_model ON agents(model)',
    agentsPlanModel: 'CREATE INDEX IF NOT EXISTS idx_agents_plan_model ON agents(plan_model)',
    agentsSmallModel: 'CREATE INDEX IF NOT EXISTS idx_agents_small_model ON agents(small_model)',
    agentsPermissionMode: 'CREATE INDEX IF NOT EXISTS idx_agents_permission_mode ON agents(permission_mode)',
    agentsCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at)',

    sessionsName: 'CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name)',
    sessionsStatus: 'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)',
    sessionsCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)',
    sessionsExternalSessionId:
      'CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id)',
    sessionsMainAgentId: 'CREATE INDEX IF NOT EXISTS idx_sessions_main_agent_id ON sessions(main_agent_id)',
    sessionsModel: 'CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model)',
    sessionsPlanModel: 'CREATE INDEX IF NOT EXISTS idx_sessions_plan_model ON sessions(plan_model)',
    sessionsSmallModel: 'CREATE INDEX IF NOT EXISTS idx_sessions_small_model ON sessions(small_model)',

    sessionLogsSessionId: 'CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id)',
    sessionLogsParentId: 'CREATE INDEX IF NOT EXISTS idx_session_logs_parent_id ON session_logs(parent_id)',
    sessionLogsRole: 'CREATE INDEX IF NOT EXISTS idx_session_logs_role ON session_logs(role)',
    sessionLogsType: 'CREATE INDEX IF NOT EXISTS idx_session_logs_type ON session_logs(type)',
    sessionLogsCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_session_logs_created_at ON session_logs(created_at)',
    sessionLogsUpdatedAt: 'CREATE INDEX IF NOT EXISTS idx_session_logs_updated_at ON session_logs(updated_at)'
  },

  // Agent operations
  agents: {
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
  },

  // Session operations
  sessions: {
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
  },

  // Session logs operations
  sessionLogs: {
    // CREATE
    insert: `
      INSERT INTO session_logs (session_id, parent_id, role, type, content, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,

    // READ
    getById: `
      SELECT * FROM session_logs
      WHERE id = ?
    `,

    getBySessionId: `
      SELECT * FROM session_logs
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `,

    getBySessionIdWithPagination: `
      SELECT * FROM session_logs
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ? OFFSET ?
    `,

    getLatestBySessionId: `
      SELECT * FROM session_logs
      WHERE session_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,

    // UPDATE
    update: `
      UPDATE session_logs
      SET content = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `,

    // DELETE
    deleteById: 'DELETE FROM session_logs WHERE id = ?',

    deleteBySessionId: 'DELETE FROM session_logs WHERE session_id = ?',

    // COUNT
    countBySessionId: 'SELECT COUNT(*) as total FROM session_logs WHERE session_id = ?'
  }
} as const

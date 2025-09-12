/**
 * Database table definitions
 */

export const TableDefinitions = {
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
} as const

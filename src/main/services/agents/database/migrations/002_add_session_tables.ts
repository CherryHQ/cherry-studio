/**
 * Session tables migration - Creates sessions and session_logs tables with indexes
 */

import type { Migration } from './types'

export const migration_002_add_session_tables: Migration = {
  id: '002',
  description: 'Create sessions and session_logs tables with indexes',
  createdAt: new Date('2024-12-09T10:00:00.000Z'),
  up: [
    // Create sessions table
    `CREATE TABLE IF NOT EXISTS sessions (
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
    )`,

    // Create session_logs table
    `CREATE TABLE IF NOT EXISTS session_logs (
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
    )`,

    // Create sessions indexes
    'CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_main_agent_id ON sessions(main_agent_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_plan_model ON sessions(plan_model)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_small_model ON sessions(small_model)',

    // Create session_logs indexes
    'CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_session_logs_parent_id ON session_logs(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_session_logs_role ON session_logs(role)',
    'CREATE INDEX IF NOT EXISTS idx_session_logs_type ON session_logs(type)',
    'CREATE INDEX IF NOT EXISTS idx_session_logs_created_at ON session_logs(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_session_logs_updated_at ON session_logs(updated_at)'
  ],
  down: [
    // Drop session_logs indexes first
    'DROP INDEX IF EXISTS idx_session_logs_updated_at',
    'DROP INDEX IF EXISTS idx_session_logs_created_at',
    'DROP INDEX IF EXISTS idx_session_logs_type',
    'DROP INDEX IF EXISTS idx_session_logs_role',
    'DROP INDEX IF EXISTS idx_session_logs_parent_id',
    'DROP INDEX IF EXISTS idx_session_logs_session_id',

    // Drop sessions indexes
    'DROP INDEX IF EXISTS idx_sessions_small_model',
    'DROP INDEX IF EXISTS idx_sessions_plan_model',
    'DROP INDEX IF EXISTS idx_sessions_model',
    'DROP INDEX IF EXISTS idx_sessions_main_agent_id',
    'DROP INDEX IF EXISTS idx_sessions_external_session_id',
    'DROP INDEX IF EXISTS idx_sessions_created_at',
    'DROP INDEX IF EXISTS idx_sessions_status',
    'DROP INDEX IF EXISTS idx_sessions_name',

    // Drop tables (session_logs first due to foreign key constraints)
    'DROP TABLE IF EXISTS session_logs',
    'DROP TABLE IF EXISTS sessions'
  ]
}

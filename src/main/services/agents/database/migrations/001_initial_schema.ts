/**
 * Initial schema migration - Creates agents table with indexes
 */

import type { Migration } from './types'

export const migration_001_initial_schema: Migration = {
  id: '001',
  description: 'Create initial agents table and indexes',
  createdAt: new Date('2024-12-09T10:00:00.000Z'),
  up: [
    // Create agents table
    `CREATE TABLE IF NOT EXISTS agents (
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
    )`,

    // Create agents indexes
    'CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)',
    'CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type)',
    'CREATE INDEX IF NOT EXISTS idx_agents_model ON agents(model)',
    'CREATE INDEX IF NOT EXISTS idx_agents_plan_model ON agents(plan_model)',
    'CREATE INDEX IF NOT EXISTS idx_agents_small_model ON agents(small_model)',
    'CREATE INDEX IF NOT EXISTS idx_agents_permission_mode ON agents(permission_mode)',
    'CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at)'
  ],
  down: [
    // Drop indexes first
    'DROP INDEX IF EXISTS idx_agents_created_at',
    'DROP INDEX IF EXISTS idx_agents_permission_mode',
    'DROP INDEX IF EXISTS idx_agents_small_model',
    'DROP INDEX IF EXISTS idx_agents_plan_model',
    'DROP INDEX IF EXISTS idx_agents_model',
    'DROP INDEX IF EXISTS idx_agents_type',
    'DROP INDEX IF EXISTS idx_agents_name',

    // Drop table
    'DROP TABLE IF EXISTS agents'
  ]
}

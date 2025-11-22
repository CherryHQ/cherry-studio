/**
 * Drizzle ORM schema for sessions and session_logs tables
 */

import { foreignKey, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsTable } from './agents.schema'

export const sessionsTable = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agent_type: text('agent_type').notNull(),
  agent_id: text('agent_id').notNull(), // Primary agent ID for the session
  name: text('name').notNull(),
  description: text('description'),
  accessible_paths: text('accessible_paths'), // JSON array of directory paths the agent can access

  instructions: text('instructions'),

  model: text('model').notNull(), // Main model ID (required)
  plan_model: text('plan_model'), // Optional plan/thinking model ID
  small_model: text('small_model'), // Optional small/fast model ID

  mcps: text('mcps'), // JSON array of MCP tool IDs
  allowed_tools: text('allowed_tools'), // JSON array of allowed tool IDs (whitelist)
  sub_agents: text('sub_agents'), // JSON array of sub-agent IDs
  slash_commands: text('slash_commands'), // JSON array of slash command objects from SDK init

  configuration: text('configuration'), // JSON, extensible settings

  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// Foreign keys for sessions table
export const sessionsFkAgent = foreignKey({
  columns: [sessionsTable.agent_id],
  foreignColumns: [agentsTable.id],
  name: 'fk_session_agent_id'
}).onDelete('cascade')

// Indexes for sessions table
export const sessionsCreatedAtIdx = index('idx_sessions_created_at').on(sessionsTable.created_at)
export const sessionsMainAgentIdIdx = index('idx_sessions_agent_id').on(sessionsTable.agent_id)
export const sessionsModelIdx = index('idx_sessions_model').on(sessionsTable.model)

export type SessionRow = typeof sessionsTable.$inferSelect
export type InsertSessionRow = typeof sessionsTable.$inferInsert

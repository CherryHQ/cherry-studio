/**
 * Drizzle ORM schema for agents table
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentsTable = sqliteTable('agents', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  deleted_at: text('deleted_at'),
  accessible_paths: text('accessible_paths'), // JSON array of directory paths the agent can access

  instructions: text('instructions'),

  model: text('model').notNull(), // Main model ID (required)
  plan_model: text('plan_model'), // Optional plan/thinking model ID
  small_model: text('small_model'), // Optional small/fast model ID

  mcps: text('mcps'), // JSON array of MCP tool IDs
  allowed_tools: text('allowed_tools'), // JSON array of allowed tool IDs (whitelist)

  configuration: text('configuration'), // JSON, extensible settings

  sort_order: integer('sort_order').notNull().default(0), // Manual sort order (lower = first)

  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// Indexes for agents table
export const agentsNameIdx = index('idx_agents_name').on(agentsTable.name)
export const agentsTypeIdx = index('idx_agents_type').on(agentsTable.type)
export const agentsCreatedAtIdx = index('idx_agents_created_at').on(agentsTable.created_at)
export const agentsSortOrderIdx = index('idx_agents_sort_order').on(agentsTable.sort_order)

export type AgentRow = typeof agentsTable.$inferSelect
export type InsertAgentRow = typeof agentsTable.$inferInsert

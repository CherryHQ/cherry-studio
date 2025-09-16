/**
 * Drizzle ORM schema for agents table
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentsTable = sqliteTable('agents', {
  id: text('id').primaryKey(),
  type: text('type').notNull().default('claude-code'),
  name: text('name').notNull(),
  description: text('description'),
  avatar: text('avatar'),
  instructions: text('instructions'),
  model: text('model').notNull(), // Main model ID (required)
  plan_model: text('plan_model'), // Optional plan/thinking model ID
  small_model: text('small_model'), // Optional small/fast model ID
  built_in_tools: text('built_in_tools'), // JSON array of built-in tool IDs
  mcps: text('mcps'), // JSON array of MCP tool IDs
  knowledges: text('knowledges'), // JSON array of enabled knowledge base IDs
  configuration: text('configuration'), // JSON, extensible settings like temperature, top_p
  accessible_paths: text('accessible_paths'), // JSON array of directory paths the agent can access
  permission_mode: text('permission_mode').default('default'), // 'readOnly', 'acceptEdits', 'bypassPermissions'
  max_steps: integer('max_steps').default(10), // Maximum number of steps the agent can take
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// Indexes for agents table
export const agentsNameIdx = index('idx_agents_name').on(agentsTable.name)
export const agentsTypeIdx = index('idx_agents_type').on(agentsTable.type)
export const agentsModelIdx = index('idx_agents_model').on(agentsTable.model)
export const agentsPlanModelIdx = index('idx_agents_plan_model').on(agentsTable.plan_model)
export const agentsSmallModelIdx = index('idx_agents_small_model').on(agentsTable.small_model)
export const agentsPermissionModeIdx = index('idx_agents_permission_mode').on(agentsTable.permission_mode)
export const agentsCreatedAtIdx = index('idx_agents_created_at').on(agentsTable.created_at)

export type AgentRow = typeof agentsTable.$inferSelect
export type InsertAgentRow = typeof agentsTable.$inferInsert

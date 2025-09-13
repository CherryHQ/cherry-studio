/**
 * Drizzle ORM schema for sessions and session_logs tables
 */

import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessionsTable = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  name: text('name'), // Session name
  main_agent_id: text('main_agent_id').notNull(), // Primary agent ID for the session
  sub_agent_ids: text('sub_agent_ids'), // JSON array of sub-agent IDs involved in the session
  user_goal: text('user_goal'), // Initial user goal for the session
  status: text('status').notNull().default('idle'), // 'idle', 'running', 'completed', 'failed', 'stopped'
  external_session_id: text('external_session_id'), // Agent session for external agent management/tracking
  // AgentConfiguration fields that can override agent defaults
  model: text('model'), // Main model ID (inherits from agent if null)
  plan_model: text('plan_model'), // Optional plan/thinking model ID
  small_model: text('small_model'), // Optional small/fast model ID
  built_in_tools: text('built_in_tools'), // JSON array of built-in tool IDs
  mcps: text('mcps'), // JSON array of MCP tool IDs
  knowledges: text('knowledges'), // JSON array of enabled knowledge base IDs
  configuration: text('configuration'), // JSON, extensible settings like temperature, top_p
  accessible_paths: text('accessible_paths'), // JSON array of directory paths the agent can access
  permission_mode: text('permission_mode').default('readOnly'), // 'readOnly', 'acceptEdits', 'bypassPermissions'
  max_steps: integer('max_steps').default(10), // Maximum number of steps the agent can take
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// Indexes for sessions table
export const sessionsNameIdx = index('idx_sessions_name').on(sessionsTable.name)
export const sessionsStatusIdx = index('idx_sessions_status').on(sessionsTable.status)
export const sessionsCreatedAtIdx = index('idx_sessions_created_at').on(sessionsTable.created_at)
export const sessionsExternalSessionIdIdx = index('idx_sessions_external_session_id').on(
  sessionsTable.external_session_id
)
export const sessionsMainAgentIdIdx = index('idx_sessions_main_agent_id').on(sessionsTable.main_agent_id)
export const sessionsModelIdx = index('idx_sessions_model').on(sessionsTable.model)
export const sessionsPlanModelIdx = index('idx_sessions_plan_model').on(sessionsTable.plan_model)
export const sessionsSmallModelIdx = index('idx_sessions_small_model').on(sessionsTable.small_model)

export const sessionMessagesTable = sqliteTable('session_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  session_id: text('session_id').notNull(),
  parent_id: integer('parent_id'), // Foreign Key to session_logs.id, nullable for tree structure
  role: text('role').notNull(), // 'user', 'agent', 'system', 'tool'
  type: text('type').notNull(), // 'message', 'thought', 'action', 'observation', etc.
  content: text('content').notNull(), // JSON structured data
  metadata: text('metadata'), // JSON metadata (optional)
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// Indexes for session_messages table
export const sessionMessagesSessionIdIdx = index('idx_session_messages_session_id').on(sessionMessagesTable.session_id)
export const sessionMessagesParentIdIdx = index('idx_session_messages_parent_id').on(sessionMessagesTable.parent_id)
export const sessionMessagesRoleIdx = index('idx_session_messages_role').on(sessionMessagesTable.role)
export const sessionMessagesTypeIdx = index('idx_session_messages_type').on(sessionMessagesTable.type)
export const sessionMessagesCreatedAtIdx = index('idx_session_messages_created_at').on(sessionMessagesTable.created_at)
export const sessionMessagesUpdatedAtIdx = index('idx_session_messages_updated_at').on(sessionMessagesTable.updated_at)

// Foreign keys for session_messages table
export const sessionMessagesFkSession = foreignKey({
  columns: [sessionMessagesTable.session_id],
  foreignColumns: [sessionsTable.id],
  name: 'fk_session_messages_session_id'
}).onDelete('cascade')

export const sessionMessagesFkParent = foreignKey({
  columns: [sessionMessagesTable.parent_id],
  foreignColumns: [sessionMessagesTable.id],
  name: 'fk_session_messages_parent_id'
})

export type SessionRow = typeof sessionsTable.$inferSelect
export type InsertSessionRow = typeof sessionsTable.$inferInsert

export type SessionMessageRow = typeof sessionMessagesTable.$inferSelect
export type InsertSessionMessageRow = typeof sessionMessagesTable.$inferInsert

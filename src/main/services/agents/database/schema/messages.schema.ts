import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessionsTable } from './sessions.schema'

// session_messages table to log all messages, thoughts, actions, observations in a session
export const sessionMessagesTable = sqliteTable('session_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  session_id: text('session_id').notNull(),
  role: text('role').notNull(), // 'user', 'agent', 'system', 'tool'
  content: text('content').notNull(), // JSON structured data
  agent_session_id: text('agent_session_id').default(''),
  metadata: text('metadata'), // JSON metadata (optional)
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// Indexes for session_messages table
export const sessionMessagesSessionIdIdx = index('idx_session_messages_session_id').on(sessionMessagesTable.session_id)
export const sessionMessagesCreatedAtIdx = index('idx_session_messages_created_at').on(sessionMessagesTable.created_at)
export const sessionMessagesUpdatedAtIdx = index('idx_session_messages_updated_at').on(sessionMessagesTable.updated_at)

// Foreign keys for session_messages table
export const sessionMessagesFkSession = foreignKey({
  columns: [sessionMessagesTable.session_id],
  foreignColumns: [sessionsTable.id],
  name: 'fk_session_messages_session_id'
}).onDelete('cascade')

export type SessionMessageRow = typeof sessionMessagesTable.$inferSelect
export type InsertSessionMessageRow = typeof sessionMessagesTable.$inferInsert

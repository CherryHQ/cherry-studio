import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentSessionTable } from './agentSession'

export const agentSessionForkContextTable = sqliteTable('agent_session_fork_context', {
  sessionId: text()
    .primaryKey()
    .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
  revision: integer().notNull().default(0),
  document: text({ mode: 'json' }).$type<unknown>().notNull()
})

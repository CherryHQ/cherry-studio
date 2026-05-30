import type { AgentPersistedMessage } from '@types'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { agentSessionTable } from './agentSession'

export const agentSessionMessageTable = sqliteTable(
  'agent_session_message',
  {
    id: uuidPrimaryKeyOrdered(),
    sessionId: text()
      .notNull()
      .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    // `content` stores the full AgentPersistedMessage payload; Drizzle handles
    // JSON.stringify/parse automatically via `{ mode: 'json' }`.
    content: text({ mode: 'json' }).$type<AgentPersistedMessage>().notNull(),
    agentSessionId: text(),
    metadata: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    ...createUpdateTimestamps
  },
  (t) => [index('agent_session_message_session_id_idx').on(t.sessionId)]
)

export type AgentSessionMessageRow = typeof agentSessionMessageTable.$inferSelect
export type InsertAgentSessionMessageRow = typeof agentSessionMessageTable.$inferInsert

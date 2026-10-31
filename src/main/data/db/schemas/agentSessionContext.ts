import { type AnySQLiteColumn, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentRuntimeBackendTable } from './agentRuntimeBackend'
import { agentSessionTable } from './agentSession'

export const agentSessionContextTable = sqliteTable(
  'agent_session_context',
  {
    id: uuidPrimaryKey(),
    parentContextId: text().references((): AnySQLiteColumn => agentSessionContextTable.id, { onDelete: 'cascade' }),
    subagentId: text(),
    spawnToolCallId: text(),
    sessionId: text()
      .notNull()
      .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
    backendId: text()
      .notNull()
      .references(() => agentRuntimeBackendTable.id, { onDelete: 'restrict' }),
    // The intended identity can survive a failed native create or an unflushed Pi file.
    intendedThreadId: text(),
    nativeThreadId: text(),
    anchorMessageId: text(),
    headMessageId: text(),
    checkpointMapping: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_context_backend_idx').on(t.backendId),
    uniqueIndex('agent_session_context_child_uniq').on(t.parentContextId, t.subagentId),
    uniqueIndex('agent_session_context_anchor_uniq').on(t.sessionId, t.anchorMessageId),
    uniqueIndex('agent_session_context_native_uniq').on(t.sessionId, t.backendId, t.nativeThreadId),
    uniqueIndex('agent_session_context_intent_uniq').on(t.sessionId, t.backendId, t.intendedThreadId)
  ]
)

export type AgentSessionContextRow = typeof agentSessionContextTable.$inferSelect

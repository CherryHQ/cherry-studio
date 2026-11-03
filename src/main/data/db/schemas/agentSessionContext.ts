import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentRuntimeBackendTable } from './agentRuntimeBackend'
import { agentSessionTable } from './agentSession'

export const agentSessionContextTable = sqliteTable(
  'agent_session_context',
  {
    id: uuidPrimaryKey(),
    sessionId: text()
      .notNull()
      .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
    backendId: text()
      .notNull()
      .references(() => agentRuntimeBackendTable.id, { onDelete: 'restrict' }),
    nativeThreadId: text(),
    bindingState: text({ enum: ['pending', 'bound'] })
      .notNull()
      .default('pending'),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_context_backend_idx').on(t.backendId),
    uniqueIndex('agent_session_context_native_uniq').on(t.sessionId, t.backendId, t.nativeThreadId),
    check('agent_session_context_binding_state_check', sql`${t.bindingState} IN ('pending', 'bound')`),
    check(
      'agent_session_context_bound_identity_check',
      sql`${t.bindingState} != 'bound' OR ${t.nativeThreadId} IS NOT NULL`
    )
  ]
)

export type AgentSessionContextRow = typeof agentSessionContextTable.$inferSelect

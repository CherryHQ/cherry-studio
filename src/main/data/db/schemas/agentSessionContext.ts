import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentRuntimeBackendTable } from './agentRuntimeBackend'
import { agentSessionTable } from './agentSession'

export interface AgentSessionCheckpoints {
  fork?: Record<string, unknown>
  root?: {
    version?: 2
    sources: Record<string, { messageId: string; offset: number; count: number }>
    removed: string[]
  }
  child?: {
    sources: Record<string, string>
    gap?: string
    removed?: readonly string[]
    composition?: Record<string, { messageId: string; parts: number[] }[]>
  }
  /**
   * Last stale-resume reset boundary this binding has already survived.
   * Rotation is limited to the invalidated binding: once a context records the
   * boundary it was rotated/allocated for, later native changes on descendants
   * (e.g. `/clear`) fork a separate context instead of rewriting this one in
   * place, preserving observers holding `(contextId, nativeThreadId)` (#23519).
   */
  staleResetHandled?: string
}

export const agentSessionContextTable = sqliteTable(
  'agent_session_context',
  {
    id: uuidPrimaryKey(),
    parentContextId: text().references((): AnySQLiteColumn => agentSessionContextTable.id, { onDelete: 'cascade' }),
    spawnToolCallId: text(),
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
    anchorMessageId: text(),
    checkpointMapping: text({ mode: 'json' }).$type<AgentSessionCheckpoints>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_context_backend_idx').on(t.backendId),
    uniqueIndex('agent_session_context_child_uniq').on(t.parentContextId, t.nativeThreadId),
    uniqueIndex('agent_session_context_anchor_uniq').on(t.sessionId, t.anchorMessageId),
    uniqueIndex('agent_session_context_native_uniq').on(t.sessionId, t.backendId, t.nativeThreadId),
    check('agent_session_context_binding_state_check', sql`${t.bindingState} IN ('pending', 'bound')`),
    check(
      'agent_session_context_bound_identity_check',
      sql`${t.bindingState} != 'bound' OR ${t.nativeThreadId} IS NOT NULL`
    )
  ]
)

export type AgentSessionContextRow = typeof agentSessionContextTable.$inferSelect

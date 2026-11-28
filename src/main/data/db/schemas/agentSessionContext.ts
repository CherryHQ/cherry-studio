import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { LocalAgentModelSelection } from '@shared/ai/localAgent'
import type { EndpointType } from '@shared/data/types/model'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentRuntimeBackendTable } from './agentRuntimeBackend'
import { agentSessionTable } from './agentSession'

export interface ClaudeCodeReplayState {
  modelAddress: string
  endpointType?: EndpointType
  metadata: SharedV3ProviderMetadata
}

export type ClaudeCodeReplayEntry = ClaudeCodeReplayState | 'ambiguous' | null

export interface AgentSessionCheckpoints {
  referenceHistory?: true
  fork?: Record<string, unknown>
  claudeCodeReplay?: Record<string, ClaudeCodeReplayEntry>
  root?: {
    version?: 2 | 3
    sources: Record<string, { messageId: string } & ({ partIds: string[] } | { offset: number; count: number })>
    removed: string[]
  }
  child?: {
    sources: Record<string, string>
    gap?: string
    removed?: readonly string[]
    composition?: Record<string, { messageId: string; parts: number[] }[]>
  }
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
    localModel: text({ mode: 'json' }).$type<LocalAgentModelSelection>(),
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

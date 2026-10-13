import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { WorkspaceCopyStatistics } from '@shared/data/api/schemas/agentWorkspaceCopies'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentWorkspaceTable } from './agentWorkspace'

export interface WorkspaceCopyLocation {
  version: 1
  storageRoot: string
  sourceWorkspaceId: string
  root: string
  project: string
}

export interface WorkspaceCopyOwnership {
  parent: string
  container: string
  project: string
  index: string
}

export const agentWorkspaceCopyTable = sqliteTable(
  'agent_workspace_copy',
  {
    id: uuidPrimaryKey(),
    requestId: text().notNull(),
    requestDigest: text().notNull(),
    revision: integer().notNull().default(0),
    sourceWorkspaceId: text().references(() => agentWorkspaceTable.id, { onDelete: 'set null' }),
    sourcePath: text().notNull(),
    sourceIdentity: text().notNull(),
    sourceCopyId: text(),
    consumer: text({ enum: ['standalone', 'session-fork'] }).notNull(),
    forkOperationId: text(),
    intendedSessionId: text(),
    reservedWorkspaceId: text().notNull(),
    targetWorkspaceId: text().references(() => agentWorkspaceTable.id, { onDelete: 'set null' }),
    name: text().notNull(),
    location: text({ mode: 'json' }).$type<WorkspaceCopyLocation>().notNull(),
    ownershipToken: text().notNull(),
    ownership: text({ mode: 'json' }).$type<WorkspaceCopyOwnership>(),
    state: text({ enum: ['creating', 'prepared', 'ready', 'failed', 'cancelled', 'deleting', 'removed'] })
      .notNull()
      .default('creating'),
    cleanup: text({ enum: ['none', 'pending', 'blocked'] })
      .notNull()
      .default('none'),
    cleanupReason: text(),
    errorCode: text(),
    policyVersion: integer().notNull().default(1),
    statistics: text({ mode: 'json' }).$type<WorkspaceCopyStatistics>(),
    storageFallback: text(),
    preparedAt: integer(),
    publishedAt: integer(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('agent_workspace_copy_request_unique_idx').on(t.requestId),
    uniqueIndex('agent_workspace_copy_target_unique_idx').on(t.targetWorkspaceId),
    index('agent_workspace_copy_source_idx').on(t.sourceWorkspaceId),
    index('agent_workspace_copy_state_idx').on(t.state, t.cleanup),
    check(
      'agent_workspace_copy_state_check',
      sql`${t.state} IN ('creating', 'prepared', 'ready', 'failed', 'cancelled', 'deleting', 'removed')`
    ),
    check('agent_workspace_copy_cleanup_check', sql`${t.cleanup} IN ('none', 'pending', 'blocked')`),
    check('agent_workspace_copy_consumer_check', sql`${t.consumer} IN ('standalone', 'session-fork')`)
  ]
)

export type AgentWorkspaceCopyRow = typeof agentWorkspaceCopyTable.$inferSelect
export type InsertAgentWorkspaceCopyRow = typeof agentWorkspaceCopyTable.$inferInsert

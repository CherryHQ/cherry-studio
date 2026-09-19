import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type {
  ExternalKnowledgeSourceState,
  ExternalKnowledgeSyncOutcome,
  ExternalKnowledgeSyncTrigger,
  FeishuExternalKnowledgeScope
} from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeConnectionProvider } from '@shared/data/types/externalKnowledgeConnection'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { externalKnowledgeConnectionTable } from './externalKnowledgeConnection'
import { jobScheduleTable } from './job'
import { knowledgeBaseTable } from './knowledge'

export const externalKnowledgeSourceTable = sqliteTable(
  'external_knowledge_source',
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),
    connectionId: text()
      .notNull()
      .references(() => externalKnowledgeConnectionTable.id, { onDelete: 'restrict' }),
    provider: text().$type<ExternalKnowledgeConnectionProvider>().notNull(),
    tenantId: text().notNull(),
    spaceId: text().notNull(),
    scope: text({ mode: 'json' }).$type<FeishuExternalKnowledgeScope>().notNull(),
    name: text().notNull(),
    state: text().$type<ExternalKnowledgeSourceState>().notNull(),
    scheduleId: text().references(() => jobScheduleTable.id, { onDelete: 'set null' }),
    revision: integer().notNull(),
    activeJobId: text(),
    lastTrigger: text().$type<ExternalKnowledgeSyncTrigger>(),
    lastStartedAt: integer(),
    lastFinishedAt: integer(),
    lastOutcome: text().$type<ExternalKnowledgeSyncOutcome>(),
    lastScannedCount: integer(),
    lastIndexedCount: integer(),
    lastUnchangedCount: integer(),
    lastSkippedCount: integer(),
    lastWarningCount: integer(),
    lastErrorSummary: text(),
    lastSuccessfulSyncAt: integer(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('external_knowledge_source_base_provider_tenant_space_uq').on(
      t.baseId,
      t.provider,
      t.tenantId,
      t.spaceId
    ),
    index('external_knowledge_source_connection_idx').on(t.connectionId),
    index('external_knowledge_source_schedule_idx').on(t.scheduleId),
    check('external_knowledge_source_provider_check', sql`${t.provider} = 'feishu'`),
    check('external_knowledge_source_state_check', sql`${t.state} IN ('active', 'paused')`),
    check('external_knowledge_source_revision_check', sql`${t.revision} >= 0`),
    check(
      'external_knowledge_source_identity_nonempty_check',
      sql`length(trim(${t.tenantId})) > 0
          AND length(trim(${t.spaceId})) > 0
          AND length(trim(${t.name})) > 0`
    ),
    check(
      'external_knowledge_source_scope_check',
      sql`json_valid(${t.scope})
          AND json_type(${t.scope}) = 'object'
          AND json_extract(${t.scope}, '$.kind') IN ('space', 'node', 'document')
          AND (
            json_extract(${t.scope}, '$.kind') = 'space'
            OR coalesce(length(trim(json_extract(${t.scope}, '$.nodeId'))), 0) > 0
          )
          AND (
            json_extract(${t.scope}, '$.kind') != 'document'
            OR coalesce(length(trim(json_extract(${t.scope}, '$.remoteObjectId'))), 0) > 0
          )`
    ),
    check(
      'external_knowledge_source_last_trigger_check',
      sql`${t.lastTrigger} IS NULL OR ${t.lastTrigger} IN ('initial', 'manual', 'scheduled', 'startup')`
    ),
    check(
      'external_knowledge_source_last_outcome_check',
      sql`${t.lastOutcome} IS NULL OR ${t.lastOutcome} IN ('completed', 'completed-with-warnings', 'failed', 'cancelled')`
    ),
    check(
      'external_knowledge_source_counts_check',
      sql`(${t.lastScannedCount} IS NULL OR ${t.lastScannedCount} >= 0)
          AND (${t.lastIndexedCount} IS NULL OR ${t.lastIndexedCount} >= 0)
          AND (${t.lastUnchangedCount} IS NULL OR ${t.lastUnchangedCount} >= 0)
          AND (${t.lastSkippedCount} IS NULL OR ${t.lastSkippedCount} >= 0)
          AND (${t.lastWarningCount} IS NULL OR ${t.lastWarningCount} >= 0)`
    ),
    check(
      'external_knowledge_source_error_nonempty_check',
      sql`${t.lastErrorSummary} IS NULL OR length(trim(${t.lastErrorSummary})) > 0`
    )
  ]
)

export type ExternalKnowledgeSourceRow = typeof externalKnowledgeSourceTable.$inferSelect
export type InsertExternalKnowledgeSourceRow = typeof externalKnowledgeSourceTable.$inferInsert

import { and, desc, eq, isNull } from 'drizzle-orm'

import { application } from '@application'
import {
  type ExternalKnowledgeSourceRow,
  type InsertExternalKnowledgeSourceRow,
  externalKnowledgeSourceTable
} from '@data/db/schemas/externalKnowledgeSource'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  type ExternalKnowledgeSource,
  ExternalKnowledgeSourceSchema,
  type ExternalKnowledgeSyncOutcome,
  type ExternalKnowledgeSyncTrigger
} from '@shared/data/types/externalKnowledge'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const nullableTimestampToISO = (value: number | null): string | null => (value === null ? null : timestampToISO(value))

export type CreateExternalKnowledgeSourceInput = Pick<
  InsertExternalKnowledgeSourceRow,
  'baseId' | 'connectionId' | 'provider' | 'tenantId' | 'spaceId' | 'scope' | 'name'
>

export type BeginExternalKnowledgeSyncInput = {
  sourceId: string
  expectedRevision: number
  expectedActiveJobId: string | null
  jobId: string
  trigger: ExternalKnowledgeSyncTrigger
  startedAt: number
}

export type SettleExternalKnowledgeSyncInput = {
  sourceId: string
  expectedRevision: number
  jobId: string
  finishedAt: number
  outcome: ExternalKnowledgeSyncOutcome
  scannedCount: number
  indexedCount: number
  unchangedCount: number
  skippedCount: number
  warningCount: number
  errorSummary: string | null
}

function rowToEntity(row: ExternalKnowledgeSourceRow): ExternalKnowledgeSource {
  return ExternalKnowledgeSourceSchema.parse({
    ...row,
    lastStartedAt: nullableTimestampToISO(row.lastStartedAt),
    lastFinishedAt: nullableTimestampToISO(row.lastFinishedAt),
    lastSuccessfulSyncAt: nullableTimestampToISO(row.lastSuccessfulSyncAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

export class ExternalKnowledgeSourceService {
  private get db() {
    return application.get('DbService').getDb()
  }

  listByBaseId(baseId: string): ExternalKnowledgeSource[] {
    knowledgeBaseService.getById(baseId)
    return this.db
      .select()
      .from(externalKnowledgeSourceTable)
      .where(eq(externalKnowledgeSourceTable.baseId, baseId))
      .orderBy(desc(externalKnowledgeSourceTable.updatedAt), desc(externalKnowledgeSourceTable.id))
      .all()
      .map(rowToEntity)
  }

  getById(id: string): ExternalKnowledgeSource | null {
    return this.getByIdTx(this.db, id)
  }

  getByIdTx(tx: Pick<DbType, 'select'>, id: string): ExternalKnowledgeSource | null {
    const row = tx
      .select()
      .from(externalKnowledgeSourceTable)
      .where(eq(externalKnowledgeSourceTable.id, id))
      .limit(1)
      .get()
    return row ? rowToEntity(row) : null
  }

  createTx(tx: Pick<DbType, 'insert'>, input: CreateExternalKnowledgeSourceInput): ExternalKnowledgeSource {
    const [row] = withSqliteErrors(
      () =>
        tx
          .insert(externalKnowledgeSourceTable)
          .values({ ...input, state: 'active', scheduleId: null, revision: 0 })
          .returning()
          .all(),
      defaultHandlersFor(
        'ExternalKnowledgeSource',
        `${input.baseId}:${input.provider}:${input.tenantId}:${input.spaceId}`
      )
    )
    if (!row) {
      throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Source create result missing')
    }
    return rowToEntity(row)
  }

  beginSyncTx(tx: Pick<DbType, 'update'>, input: BeginExternalKnowledgeSyncInput): boolean {
    const activeJobFence =
      input.expectedActiveJobId === null
        ? isNull(externalKnowledgeSourceTable.activeJobId)
        : eq(externalKnowledgeSourceTable.activeJobId, input.expectedActiveJobId)
    const result = tx
      .update(externalKnowledgeSourceTable)
      .set({ activeJobId: input.jobId, lastTrigger: input.trigger, lastStartedAt: input.startedAt })
      .where(
        and(
          eq(externalKnowledgeSourceTable.id, input.sourceId),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          activeJobFence
        )
      )
      .run()
    return result.changes > 0
  }

  settleSyncTx(tx: Pick<DbType, 'update'>, input: SettleExternalKnowledgeSyncInput): boolean {
    const succeeded = input.outcome === 'completed' || input.outcome === 'completed-with-warnings'
    const result = tx
      .update(externalKnowledgeSourceTable)
      .set({
        activeJobId: null,
        lastFinishedAt: input.finishedAt,
        lastOutcome: input.outcome,
        lastScannedCount: input.scannedCount,
        lastIndexedCount: input.indexedCount,
        lastUnchangedCount: input.unchangedCount,
        lastSkippedCount: input.skippedCount,
        lastWarningCount: input.warningCount,
        lastErrorSummary: input.errorSummary,
        lastSuccessfulSyncAt: succeeded ? input.finishedAt : undefined
      })
      .where(
        and(
          eq(externalKnowledgeSourceTable.id, input.sourceId),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          eq(externalKnowledgeSourceTable.activeJobId, input.jobId)
        )
      )
      .run()
    return result.changes > 0
  }
}

export const externalKnowledgeSourceService = new ExternalKnowledgeSourceService()

import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { application } from '@application'
import {
  type ExternalKnowledgeSourceRow,
  type InsertExternalKnowledgeSourceRow,
  externalKnowledgeSourceTable
} from '@data/db/schemas/externalKnowledgeSource'
import { type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  type ExternalKnowledgeSource,
  type ExternalKnowledgeSourceState,
  ExternalKnowledgeSourceSchema,
  type ExternalKnowledgeSyncOutcome,
  type ExternalKnowledgeSyncTrigger
} from '@shared/data/types/externalKnowledge'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const nullableTimestampToISO = (value: number | null): string | null => (value === null ? null : timestampToISO(value))
const SOURCE_SCOPE_CONFLICT_MESSAGE = 'An external knowledge source already exists for this provider scope'

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

export type SetExternalKnowledgeSourceScheduleInput = {
  sourceId: string
  expectedRevision: number
  expectedScheduleId: string | null
  scheduleId: string | null
}

export type SetExternalKnowledgeSourceStateInput = {
  sourceId: string
  expectedRevision: number
  expectedState: ExternalKnowledgeSourceState
  state: ExternalKnowledgeSourceState
}

export type ClearExternalKnowledgeActiveJobInput = {
  sourceId: string
  expectedRevision: number
  expectedActiveJobId: string
}

export type PrepareExternalKnowledgeSourceDisconnectInput = {
  sourceId: string
  expectedRevision: number
  expectedScheduleId: null
}

export type DeleteExternalKnowledgeSourceDisconnectInput = PrepareExternalKnowledgeSourceDisconnectInput & {
  expectedActiveJobId: string | null
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
    return this.listByBaseIdTx(this.db, baseId)
  }

  listByBaseIdTx(tx: Pick<DbType, 'select'>, baseId: string): ExternalKnowledgeSource[] {
    return tx
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

  listByConnectionId(connectionId: string): ExternalKnowledgeSource[] {
    return this.listByConnectionIdTx(this.db, connectionId)
  }

  listByConnectionIdTx(tx: Pick<DbType, 'select'>, connectionId: string): ExternalKnowledgeSource[] {
    return tx
      .select()
      .from(externalKnowledgeSourceTable)
      .where(eq(externalKnowledgeSourceTable.connectionId, connectionId))
      .orderBy(desc(externalKnowledgeSourceTable.updatedAt), desc(externalKnowledgeSourceTable.id))
      .all()
      .map(rowToEntity)
  }

  listWithActiveJobId(): ExternalKnowledgeSource[] {
    return this.db
      .select()
      .from(externalKnowledgeSourceTable)
      .where(isNotNull(externalKnowledgeSourceTable.activeJobId))
      .orderBy(desc(externalKnowledgeSourceTable.updatedAt), desc(externalKnowledgeSourceTable.id))
      .all()
      .map(rowToEntity)
  }

  createTx(tx: Pick<DbType, 'select' | 'insert'>, input: CreateExternalKnowledgeSourceInput): ExternalKnowledgeSource {
    const existing = tx
      .select({ id: externalKnowledgeSourceTable.id })
      .from(externalKnowledgeSourceTable)
      .where(
        and(
          eq(externalKnowledgeSourceTable.baseId, input.baseId),
          eq(externalKnowledgeSourceTable.provider, input.provider),
          eq(externalKnowledgeSourceTable.tenantId, input.tenantId),
          eq(externalKnowledgeSourceTable.spaceId, input.spaceId)
        )
      )
      .limit(1)
      .get()
    if (existing) {
      throw DataApiErrorFactory.conflict(SOURCE_SCOPE_CONFLICT_MESSAGE, 'ExternalKnowledgeSource')
    }

    const [row] = withSqliteErrors(
      () =>
        tx
          .insert(externalKnowledgeSourceTable)
          .values({ ...input, state: 'active', scheduleId: null, revision: 0 })
          .returning()
          .all(),
      {
        unique: () => DataApiErrorFactory.conflict(SOURCE_SCOPE_CONFLICT_MESSAGE, 'ExternalKnowledgeSource'),
        foreignKey: () => DataApiErrorFactory.notFound('ExternalKnowledgeSourceTarget'),
        check: () =>
          DataApiErrorFactory.validation(
            { _root: ['External knowledge source violates persisted validation constraints'] },
            'External knowledge source violates persisted validation constraints'
          ),
        notNull: () =>
          DataApiErrorFactory.validation(
            { _root: ['External knowledge source is missing persisted required data'] },
            'External knowledge source is missing persisted required data'
          )
      } satisfies SqliteErrorHandlers
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
          eq(externalKnowledgeSourceTable.state, 'active'),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          activeJobFence
        )
      )
      .run()
    return result.changes > 0
  }

  setScheduleIdTx(tx: Pick<DbType, 'update'>, input: SetExternalKnowledgeSourceScheduleInput): boolean {
    const scheduleFence =
      input.expectedScheduleId === null
        ? isNull(externalKnowledgeSourceTable.scheduleId)
        : eq(externalKnowledgeSourceTable.scheduleId, input.expectedScheduleId)
    const result = tx
      .update(externalKnowledgeSourceTable)
      .set({ scheduleId: input.scheduleId })
      .where(
        and(
          eq(externalKnowledgeSourceTable.id, input.sourceId),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          scheduleFence
        )
      )
      .run()
    return result.changes > 0
  }

  setStateTx(tx: Pick<DbType, 'update'>, input: SetExternalKnowledgeSourceStateInput): boolean {
    const result = tx
      .update(externalKnowledgeSourceTable)
      .set({ state: input.state, revision: sql`${externalKnowledgeSourceTable.revision} + 1` })
      .where(
        and(
          eq(externalKnowledgeSourceTable.id, input.sourceId),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          eq(externalKnowledgeSourceTable.state, input.expectedState)
        )
      )
      .run()
    return result.changes > 0
  }

  clearActiveJobTx(tx: Pick<DbType, 'update'>, input: ClearExternalKnowledgeActiveJobInput): boolean {
    const result = tx
      .update(externalKnowledgeSourceTable)
      .set({ activeJobId: null })
      .where(
        and(
          eq(externalKnowledgeSourceTable.id, input.sourceId),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          eq(externalKnowledgeSourceTable.activeJobId, input.expectedActiveJobId)
        )
      )
      .run()
    return result.changes > 0
  }

  prepareDisconnectTx(
    tx: Pick<DbType, 'select' | 'update'>,
    input: PrepareExternalKnowledgeSourceDisconnectInput
  ): ExternalKnowledgeSource | null {
    const source = this.getByIdTx(tx, input.sourceId)
    if (!source || source.revision !== input.expectedRevision || source.scheduleId !== input.expectedScheduleId) {
      return null
    }
    if (source.state === 'paused') return source

    const changed = this.setStateTx(tx, {
      sourceId: source.id,
      expectedRevision: source.revision,
      expectedState: 'active',
      state: 'paused'
    })
    return changed ? this.getByIdTx(tx, source.id) : null
  }

  deleteForDisconnectTx(tx: Pick<DbType, 'delete'>, input: DeleteExternalKnowledgeSourceDisconnectInput): boolean {
    const activeJobFence =
      input.expectedActiveJobId === null
        ? isNull(externalKnowledgeSourceTable.activeJobId)
        : eq(externalKnowledgeSourceTable.activeJobId, input.expectedActiveJobId)
    const result = tx
      .delete(externalKnowledgeSourceTable)
      .where(
        and(
          eq(externalKnowledgeSourceTable.id, input.sourceId),
          eq(externalKnowledgeSourceTable.state, 'paused'),
          eq(externalKnowledgeSourceTable.revision, input.expectedRevision),
          isNull(externalKnowledgeSourceTable.scheduleId),
          activeJobFence
        )
      )
      .run()
    return result.changes > 0
  }

  deleteByBaseIdTx(tx: Pick<DbType, 'select' | 'delete'>, baseId: string): number {
    const scheduled = tx
      .select({ id: externalKnowledgeSourceTable.id })
      .from(externalKnowledgeSourceTable)
      .where(and(eq(externalKnowledgeSourceTable.baseId, baseId), isNotNull(externalKnowledgeSourceTable.scheduleId)))
      .limit(1)
      .get()
    if (scheduled) {
      throw DataApiErrorFactory.invalidOperation(
        'delete knowledge base',
        'remove external knowledge source schedules before deleting sources'
      )
    }
    return tx.delete(externalKnowledgeSourceTable).where(eq(externalKnowledgeSourceTable.baseId, baseId)).run().changes
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

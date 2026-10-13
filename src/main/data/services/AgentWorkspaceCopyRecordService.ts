import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'

import { application } from '@application'
import {
  agentWorkspaceCopyTable as copies,
  type AgentWorkspaceCopyRow,
  type InsertAgentWorkspaceCopyRow,
  type WorkspaceCopyOwnership
} from '@data/db/schemas/agentWorkspaceCopy'
import type { DbOrTx } from '@data/db/types'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { WorkspaceCopyEntity, WorkspaceCopyStatistics } from '@shared/data/api/schemas/agentWorkspaceCopies'

export interface PreparedWorkspaceCopy {
  readonly copyId: string
  readonly reservedWorkspaceId: string
  readonly cwd: string
  readonly revision: number
}

export class AgentWorkspaceCopyRecordService {
  get(id: string, tx: DbOrTx = application.get('DbService').getDb()): AgentWorkspaceCopyRow {
    const row = tx.select().from(copies).where(eq(copies.id, id)).get()
    if (!row) throw DataApiErrorFactory.notFound('Workspace copy', id)
    return row
  }

  findRequest(requestId: string, tx: DbOrTx = application.get('DbService').getDb()) {
    return tx.select().from(copies).where(eq(copies.requestId, requestId)).get()
  }

  list(tx: DbOrTx = application.get('DbService').getDb()): AgentWorkspaceCopyRow[] {
    return tx.select().from(copies).orderBy(desc(copies.createdAt)).all()
  }

  listPending(): AgentWorkspaceCopyRow[] {
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(copies)
      .where(
        and(
          or(
            inArray(copies.state, ['creating', 'prepared', 'deleting']),
            and(inArray(copies.state, ['failed', 'cancelled']), eq(copies.cleanup, 'pending'))
          ),
          sql`${copies.cleanup} != 'blocked'`
        )
      )
      .all()
  }

  toEntity(row: AgentWorkspaceCopyRow): WorkspaceCopyEntity {
    return {
      id: row.id,
      requestId: row.requestId,
      revision: row.revision,
      sourceWorkspaceId: row.sourceWorkspaceId,
      targetWorkspaceId: row.targetWorkspaceId,
      intendedSessionId: row.intendedSessionId,
      name: row.name,
      path: row.location.project,
      state: row.state,
      cleanup: row.cleanup,
      cleanupReason: row.cleanupReason,
      errorCode: row.errorCode,
      statistics: row.statistics,
      storageFallback: row.storageFallback,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  reserveTx(tx: DbOrTx, input: InsertAgentWorkspaceCopyRow): AgentWorkspaceCopyRow {
    const existing = this.findRequest(input.requestId, tx)
    if (existing) {
      if (existing.requestDigest !== input.requestDigest)
        throw DataApiErrorFactory.conflict('request_conflict', 'Workspace copy')
      return existing
    }
    if (!input.sourceWorkspaceId) throw DataApiErrorFactory.conflict('source_missing', 'Workspace copy')
    agentWorkspaceService.assertUsableTx(tx, input.sourceWorkspaceId)
    return tx.insert(copies).values(input).returning().get()
  }

  private updateTx(
    tx: DbOrTx,
    row: AgentWorkspaceCopyRow,
    values: Partial<InsertAgentWorkspaceCopyRow>
  ): AgentWorkspaceCopyRow {
    const updated = tx
      .update(copies)
      .set({ ...values, revision: row.revision + 1 })
      .where(and(eq(copies.id, row.id), eq(copies.revision, row.revision), eq(copies.state, row.state)))
      .returning()
      .get()
    if (!updated) throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    return updated
  }

  recordOwnershipTx(tx: DbOrTx, id: string, ownership: WorkspaceCopyOwnership): AgentWorkspaceCopyRow {
    const row = this.get(id, tx)
    if (row.state !== 'creating' || row.ownership)
      throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    return this.updateTx(tx, row, { ownership })
  }

  markPreparedTx(tx: DbOrTx, id: string, statistics: WorkspaceCopyStatistics): AgentWorkspaceCopyRow {
    const row = this.get(id, tx)
    if (row.state !== 'creating' || !row.ownership)
      throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    return this.updateTx(tx, row, { state: 'prepared', statistics, preparedAt: Date.now() })
  }

  publishTx(tx: DbOrTx, prepared: PreparedWorkspaceCopy): string {
    const row = this.get(prepared.copyId, tx)
    if (
      row.state !== 'prepared' ||
      row.revision !== prepared.revision ||
      !row.ownership ||
      row.reservedWorkspaceId !== prepared.reservedWorkspaceId ||
      row.location.project !== prepared.cwd
    ) {
      throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    }
    if (!row.sourceWorkspaceId) throw DataApiErrorFactory.conflict('source_missing', 'Workspace copy')
    agentWorkspaceService.assertUsableTx(tx, row.sourceWorkspaceId)
    agentWorkspaceService.createManagedCopyTx(tx, {
      id: row.reservedWorkspaceId,
      name: row.name,
      path: row.location.project
    })
    this.updateTx(tx, row, { state: 'ready', targetWorkspaceId: row.reservedWorkspaceId, publishedAt: Date.now() })
    return row.reservedWorkspaceId
  }

  relinkTx(tx: DbOrTx, id: string): string {
    const row = this.get(id, tx)
    if (row.state !== 'ready') throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    if (row.targetWorkspaceId) return row.targetWorkspaceId
    agentWorkspaceService.createManagedCopyTx(tx, {
      id: row.reservedWorkspaceId,
      name: row.name,
      path: row.location.project
    })
    this.updateTx(tx, row, { targetWorkspaceId: row.reservedWorkspaceId })
    return row.reservedWorkspaceId
  }

  recordFailureTx(tx: DbOrTx, id: string, errorCode: string, resourcesCreated: boolean): AgentWorkspaceCopyRow {
    const row = this.get(id, tx)
    if (row.state !== 'creating' && row.state !== 'prepared') return row
    return this.updateTx(tx, row, {
      state: errorCode === 'cancelled' ? 'cancelled' : 'failed',
      errorCode,
      cleanup: resourcesCreated ? 'pending' : 'none'
    })
  }

  recordCleanupTx(
    tx: DbOrTx,
    id: string,
    cleanup: AgentWorkspaceCopyRow['cleanup'],
    cleanupReason: string | null = null
  ): AgentWorkspaceCopyRow {
    const row = this.get(id, tx)
    if (!['failed', 'cancelled', 'deleting'].includes(row.state))
      throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    return this.updateTx(tx, row, { cleanup, cleanupReason })
  }

  beginDeleteTx(tx: DbOrTx, id: string, expectedRevision: number): AgentWorkspaceCopyRow {
    const row = this.get(id, tx)
    if (row.state === 'removed' || row.state === 'deleting') return row
    if (row.state !== 'ready' || row.revision !== expectedRevision)
      throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    this.assertUnreferencedTx(tx, row.id)
    return this.updateTx(tx, row, { state: 'deleting', cleanup: 'pending' })
  }

  assertUnreferencedTx(tx: DbOrTx, id: string): void {
    const row = this.get(id, tx)
    if (row.targetWorkspaceId) {
      const refs = agentWorkspaceService.getReferencesTx(tx, row.targetWorkspaceId)
      if (refs.sessions.total || refs.channels.total || refs.tasks.total)
        throw DataApiErrorFactory.conflict('workspace_in_use', 'Workspace copy')
    }
    if (
      tx
        .select({ id: copies.id })
        .from(copies)
        .where(and(eq(copies.sourceCopyId, row.id), inArray(copies.state, ['creating', 'prepared'])))
        .get()
    ) {
      throw DataApiErrorFactory.conflict('workspace_in_use', 'Workspace copy')
    }
  }

  finishDeleteTx(tx: DbOrTx, id: string): AgentWorkspaceCopyRow {
    const row = this.get(id, tx)
    if (row.state !== 'deleting') throw DataApiErrorFactory.conflict('state_conflict', 'Workspace copy')
    if (row.targetWorkspaceId) agentWorkspaceService.deleteByIdTx(tx, row.targetWorkspaceId)
    return this.updateTx(tx, row, { state: 'removed', targetWorkspaceId: null, cleanup: 'none', cleanupReason: null })
  }
}

export const agentWorkspaceCopyRecordService = new AgentWorkspaceCopyRecordService()

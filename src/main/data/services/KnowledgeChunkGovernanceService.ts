import { createHash } from 'node:crypto'

import { and, asc, eq } from 'drizzle-orm'

import { application } from '@application'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import {
  knowledgeChunkGovernanceHistoryTable,
  knowledgeChunkGovernanceTable
} from '@data/db/schemas/knowledgeChunkGovernance'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  KnowledgeChunkGovernanceSourceSchema,
  KnowledgeChunkGovernanceStateSchema,
  type KnowledgeChunkGovernanceSource,
  type KnowledgeChunkGovernanceState
} from '@shared/data/types/knowledgeChunkGovernance'

const logger = loggerService.withContext('DataApi:KnowledgeChunkGovernanceService')
const tables = knowledgeChunkGovernanceTable
export type KnowledgeChunkGovernanceRow = typeof knowledgeChunkGovernanceTable.$inferSelect

/** Storage only. The Knowledge workflow must validate source identity and synchronize retrieval before exposing writes. */
export class KnowledgeChunkGovernanceService {
  private get dbService() {
    return application.get('DbService')
  }

  private assertItem(tx: DbOrTx, baseId: string, itemId: string) {
    const row = tx
      .select({ item: knowledgeItemTable, base: knowledgeBaseTable })
      .from(knowledgeItemTable)
      .innerJoin(knowledgeBaseTable, eq(knowledgeBaseTable.id, knowledgeItemTable.baseId))
      .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.id, itemId)))
      .get()
    if (!row) throw DataApiErrorFactory.notFound('Knowledge item', itemId)
    if (row.base.status !== 'completed' || row.item.status !== 'completed' || row.item.type === 'directory') {
      throw DataApiErrorFactory.invalidOperation('Chunk governance requires a completed source item and base')
    }
  }

  get(baseId: string, itemId: string, unitId: string): KnowledgeChunkGovernanceRow | undefined {
    return this.dbService
      .getDb()
      .select()
      .from(tables)
      .where(and(eq(tables.baseId, baseId), eq(tables.itemId, itemId), eq(tables.unitId, unitId)))
      .get()
  }

  create(
    source: KnowledgeChunkGovernanceSource,
    requestedState: KnowledgeChunkGovernanceState
  ): KnowledgeChunkGovernanceRow {
    const input = KnowledgeChunkGovernanceSourceSchema.parse(source)
    const state = KnowledgeChunkGovernanceStateSchema.parse(requestedState)
    return this.dbService.withWriteTx((tx) => {
      this.assertItem(tx, input.baseId, input.itemId)
      const existing = tx
        .select({ id: tables.id })
        .from(tables)
        .where(and(eq(tables.baseId, input.baseId), eq(tables.itemId, input.itemId), eq(tables.unitId, input.unitId)))
        .get()
      if (existing) throw DataApiErrorFactory.conflict('Chunk governance already exists')
      const row = tx
        .insert(tables)
        .values({
          ...input,
          state,
          revision: 1,
          originalTextHash: createHash('sha256').update(input.originalText).digest('hex')
        })
        .returning()
        .get()
      tx.insert(knowledgeChunkGovernanceHistoryTable)
        .values({ governanceId: row.id, revision: row.revision, state })
        .run()
      logger.info('Saved chunk governance revision', { governanceId: row.id, revision: row.revision })
      return row
    })
  }

  updateState(input: {
    baseId: string
    itemId: string
    unitId: string
    sourceContentHash: string
    expectedRevision: number
    state: KnowledgeChunkGovernanceState
  }): KnowledgeChunkGovernanceRow {
    const state = KnowledgeChunkGovernanceStateSchema.parse(input.state)
    return this.dbService.withWriteTx((tx) => {
      this.assertItem(tx, input.baseId, input.itemId)
      const match = and(
        eq(tables.baseId, input.baseId),
        eq(tables.itemId, input.itemId),
        eq(tables.unitId, input.unitId)
      )
      const current = tx.select().from(tables).where(match).get()
      if (!current) throw DataApiErrorFactory.notFound('Chunk governance', input.unitId)
      if (current.revision !== input.expectedRevision || current.sourceContentHash !== input.sourceContentHash) {
        throw DataApiErrorFactory.conflict('Chunk source or governance revision changed')
      }
      if (JSON.stringify(current.state) === JSON.stringify(state)) return current
      const revision = current.revision + 1
      const row = tx.update(tables).set({ state, revision }).where(match).returning().get()!
      tx.insert(knowledgeChunkGovernanceHistoryTable).values({ governanceId: row.id, revision, state }).run()
      logger.info('Saved chunk governance revision', { governanceId: row.id, revision: row.revision })
      return row
    })
  }

  /** One coherent, deterministic read for retrieval revision checks. No source text is logged. */
  listByBase(baseId: string): KnowledgeChunkGovernanceRow[] {
    return this.dbService.getDb().select().from(tables).where(eq(tables.baseId, baseId)).orderBy(asc(tables.id)).all()
  }

  listHistory(baseId: string, itemId: string, unitId: string) {
    const db = this.dbService.getDb()
    return db
      .select({
        revision: knowledgeChunkGovernanceHistoryTable.revision,
        state: knowledgeChunkGovernanceHistoryTable.state,
        createdAt: knowledgeChunkGovernanceHistoryTable.createdAt
      })
      .from(knowledgeChunkGovernanceHistoryTable)
      .innerJoin(tables, eq(tables.id, knowledgeChunkGovernanceHistoryTable.governanceId))
      .where(and(eq(tables.baseId, baseId), eq(tables.itemId, itemId), eq(tables.unitId, unitId)))
      .orderBy(asc(knowledgeChunkGovernanceHistoryTable.revision))
      .all()
  }
}

export const knowledgeChunkGovernanceService = new KnowledgeChunkGovernanceService()

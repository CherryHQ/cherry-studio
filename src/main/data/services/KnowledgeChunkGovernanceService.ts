import { createHash } from 'node:crypto'

import { and, asc, desc, eq, lt } from 'drizzle-orm'

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
  KnowledgeChunkHistoryQuerySchema,
  type KnowledgeChunkHistoryQuery,
  type KnowledgeChunkHistoryPage,
  hasKnowledgeChunkDecision,
  KnowledgeChunkBatchActionSchema,
  KnowledgeChunkGovernanceSourceSchema,
  KnowledgeChunkGovernanceStateSchema,
  type KnowledgeChunkBatchAction,
  type KnowledgeChunkGovernanceSource,
  type KnowledgeChunkGovernanceState
} from '@shared/data/types/knowledgeChunkGovernance'

const logger = loggerService.withContext('DataApi:KnowledgeChunkGovernanceService')
const tables = knowledgeChunkGovernanceTable
export type KnowledgeChunkGovernanceRow = typeof knowledgeChunkGovernanceTable.$inferSelect

/** The Knowledge workflow authenticates indexed source evidence before calling the write methods. */
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

  private find(tx: DbOrTx, baseId: string, itemId: string, unitId: string) {
    return tx
      .select()
      .from(tables)
      .where(and(eq(tables.baseId, baseId), eq(tables.itemId, itemId), eq(tables.unitId, unitId)))
      .get()
  }

  get(baseId: string, itemId: string, unitId: string): KnowledgeChunkGovernanceRow | undefined {
    return this.find(this.dbService.getDb(), baseId, itemId, unitId)
  }

  private createTx(tx: DbOrTx, input: KnowledgeChunkGovernanceSource, state: KnowledgeChunkGovernanceState) {
    this.assertItem(tx, input.baseId, input.itemId)
    if (this.find(tx, input.baseId, input.itemId, input.unitId))
      throw DataApiErrorFactory.conflict('Chunk governance already exists')
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
    return row
  }

  create(
    source: KnowledgeChunkGovernanceSource,
    requestedState: KnowledgeChunkGovernanceState
  ): KnowledgeChunkGovernanceRow {
    const input = KnowledgeChunkGovernanceSourceSchema.parse(source)
    const state = KnowledgeChunkGovernanceStateSchema.parse(requestedState)
    const row = this.dbService.withWriteTx((tx) => this.createTx(tx, input, state))
    logger.info('Saved chunk governance revision', { governanceId: row.id, revision: row.revision })
    return row
  }

  private updateStateTx(
    tx: DbOrTx,
    input: {
      baseId: string
      itemId: string
      unitId: string
      sourceContentHash: string
      expectedRevision: number
      state: KnowledgeChunkGovernanceState
    },
    forceRevision = false
  ) {
    this.assertItem(tx, input.baseId, input.itemId)
    const current = this.find(tx, input.baseId, input.itemId, input.unitId)
    if (!current) throw DataApiErrorFactory.notFound('Chunk governance', input.unitId)
    if (current.revision !== input.expectedRevision || current.sourceContentHash !== input.sourceContentHash) {
      throw DataApiErrorFactory.conflict('Chunk source or governance revision changed')
    }
    if (!forceRevision && JSON.stringify(current.state) === JSON.stringify(input.state)) return current
    const revision = current.revision + 1
    const row = tx
      .update(tables)
      .set({ state: input.state, revision, retired: false })
      .where(eq(tables.id, current.id))
      .returning()
      .get()!
    tx.insert(knowledgeChunkGovernanceHistoryTable).values({ governanceId: row.id, revision, state: input.state }).run()
    return row
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
    const row = this.dbService.withWriteTx((tx) => this.updateStateTx(tx, { ...input, state }))
    logger.info('Saved chunk governance revision', { governanceId: row.id, revision: row.revision })
    return row
  }

  applyBatch(
    baseId: string,
    entries: { source: KnowledgeChunkGovernanceSource; expectedRevision: number }[],
    requestedAction: KnowledgeChunkBatchAction
  ): void {
    const action = KnowledgeChunkBatchActionSchema.parse(requestedAction)
    this.dbService.withWriteTx((tx) => {
      for (const entry of entries) {
        const source = KnowledgeChunkGovernanceSourceSchema.parse(entry.source)
        if (source.baseId !== baseId) throw DataApiErrorFactory.conflict('Chunk selection belongs to another base')
        this.assertItem(tx, baseId, source.itemId)
        const current = this.find(tx, baseId, source.itemId, source.unitId)
        if (
          (current?.revision ?? 0) !== entry.expectedRevision ||
          (current && current.sourceContentHash !== source.sourceContentHash)
        ) {
          throw DataApiErrorFactory.conflict('Chunk source or governance revision changed; reload the selection')
        }
        const previous = current?.state ?? { excluded: false, labels: [], overrideText: null }
        const state = KnowledgeChunkGovernanceStateSchema.parse(
          action.kind === 'exclusion'
            ? { ...previous, excluded: action.excluded }
            : {
                ...previous,
                labels:
                  action.operation === 'add'
                    ? [...previous.labels, action.label]
                    : previous.labels.filter((label) => label !== action.label)
              }
        )
        if (!current && !state.excluded && state.labels.length === 0) continue
        if (current) this.updateStateTx(tx, { ...source, expectedRevision: entry.expectedRevision, state })
        else this.createTx(tx, source, state)
      }
    })
    logger.info('Applied chunk governance batch', { baseId, selectionCount: entries.length })
  }

  review(input: {
    baseId: string
    itemId: string
    governanceId: string
    expectedRevision: number
    target?: { source: KnowledgeChunkGovernanceSource; expectedRevision: number }
  }): void {
    this.dbService.withWriteTx((tx) => {
      this.assertItem(tx, input.baseId, input.itemId)
      const old = tx
        .select()
        .from(tables)
        .where(and(eq(tables.id, input.governanceId), eq(tables.baseId, input.baseId), eq(tables.itemId, input.itemId)))
        .get()
      if (!old || old.revision !== input.expectedRevision || old.retired)
        throw DataApiErrorFactory.conflict('Chunk decision changed; refresh and review again')
      let target: KnowledgeChunkGovernanceRow | undefined
      if (input.target) {
        const source = KnowledgeChunkGovernanceSourceSchema.parse(input.target.source)
        if (source.baseId !== input.baseId || source.itemId !== input.itemId || source.unitId === old.unitId)
          throw DataApiErrorFactory.conflict('Rebind requires a different chunk in the same source')
        const existing = this.find(tx, input.baseId, input.itemId, source.unitId)
        if (
          (existing?.revision ?? 0) !== input.target.expectedRevision ||
          (existing &&
            (existing.sourceContentHash !== source.sourceContentHash || hasKnowledgeChunkDecision(existing.state)))
        )
          throw DataApiErrorFactory.conflict('Target decision changed or already carries decisions')
        target = existing
          ? this.updateStateTx(tx, { ...source, expectedRevision: existing.revision, state: old.state }, true)
          : this.createTx(tx, source, old.state)
        tx.update(knowledgeChunkGovernanceHistoryTable)
          .set({ operation: 'rebind-from', relatedGovernanceId: old.id })
          .where(
            and(
              eq(knowledgeChunkGovernanceHistoryTable.governanceId, target.id),
              eq(knowledgeChunkGovernanceHistoryTable.revision, target.revision)
            )
          )
          .run()
      }
      const cleared = tx
        .update(tables)
        .set({
          state: { excluded: false, labels: [], overrideText: null },
          revision: old.revision + 1,
          retired: true
        })
        .where(eq(tables.id, old.id))
        .returning()
        .get()!
      tx.insert(knowledgeChunkGovernanceHistoryTable)
        .values({
          governanceId: old.id,
          revision: cleared.revision,
          state: cleared.state,
          operation: target ? 'rebind-away' : 'discard',
          relatedGovernanceId: target?.id ?? null
        })
        .run()
    })
  }

  getDiscardedState(row: KnowledgeChunkGovernanceRow, tx: DbOrTx = this.dbService.getDb()) {
    if (!row.retired) return null
    const [latest, previous] = tx
      .select()
      .from(knowledgeChunkGovernanceHistoryTable)
      .where(eq(knowledgeChunkGovernanceHistoryTable.governanceId, row.id))
      .orderBy(desc(knowledgeChunkGovernanceHistoryTable.revision))
      .limit(2)
      .all()
    return latest?.revision === row.revision &&
      latest.operation === 'discard' &&
      previous?.revision === row.revision - 1
      ? KnowledgeChunkGovernanceStateSchema.parse(previous.state)
      : null
  }

  restoreDiscard(input: { baseId: string; itemId: string; governanceId: string; expectedRevision: number }): void {
    this.dbService.withWriteTx((tx) => {
      this.assertItem(tx, input.baseId, input.itemId)
      const old = tx
        .select()
        .from(tables)
        .where(and(eq(tables.id, input.governanceId), eq(tables.baseId, input.baseId), eq(tables.itemId, input.itemId)))
        .get()
      if (!old || !old.retired || old.revision !== input.expectedRevision)
        throw DataApiErrorFactory.conflict('Discard changed; refresh before restoring')
      const state = this.getDiscardedState(old, tx)
      if (!state) throw DataApiErrorFactory.conflict('Only the latest unchanged discard can be restored')
      const restored = tx
        .update(tables)
        .set({ state, retired: false, revision: old.revision + 1 })
        .where(eq(tables.id, old.id))
        .returning()
        .get()!
      tx.insert(knowledgeChunkGovernanceHistoryTable)
        .values({
          governanceId: old.id,
          revision: restored.revision,
          state: restored.state,
          operation: 'restore-discard'
        })
        .run()
    })
  }

  /** One coherent, deterministic read for retrieval revision checks. No source text is logged. */
  listByBase(baseId: string): KnowledgeChunkGovernanceRow[] {
    return this.dbService.getDb().select().from(tables).where(eq(tables.baseId, baseId)).orderBy(asc(tables.id)).all()
  }

  readHistoryPage(
    baseId: string,
    itemId: string,
    unitId: string,
    query: KnowledgeChunkHistoryQuery = {}
  ): KnowledgeChunkHistoryPage {
    const { beforeRevision, limit } = KnowledgeChunkHistoryQuerySchema.parse(query)
    const db = this.dbService.getDb()
    this.assertItem(db, baseId, itemId)
    const row = this.find(db, baseId, itemId, unitId)
    if (!row) return { binding: null, items: [] }
    const history = knowledgeChunkGovernanceHistoryTable
    const rows = db
      .select({
        operation: history.operation,
        relatedGovernanceId: history.relatedGovernanceId,
        revision: history.revision,
        state: history.state,
        createdAt: history.createdAt
      })
      .from(history)
      .where(and(eq(history.governanceId, row.id), beforeRevision ? lt(history.revision, beforeRevision) : undefined))
      .orderBy(desc(history.revision))
      .limit(limit + 1)
      .all()
    const items = rows.slice(0, limit)
    return {
      binding: {
        id: row.id,
        unitId: row.unitId,
        sourceContentHash: row.sourceContentHash,
        originalText: row.originalText,
        charStart: row.charStart,
        charEnd: row.charEnd,
        revision: row.revision,
        retired: row.retired
      },
      items,
      ...(rows.length > limit ? { nextBeforeRevision: items[items.length - 1].revision } : {})
    }
  }

  listHistory(baseId: string, itemId: string, unitId: string) {
    return this.dbService
      .getDb()
      .select({
        operation: knowledgeChunkGovernanceHistoryTable.operation,
        relatedGovernanceId: knowledgeChunkGovernanceHistoryTable.relatedGovernanceId,
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

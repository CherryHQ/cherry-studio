import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import {
  knowledgeChunkGovernanceHistoryTable,
  knowledgeChunkGovernanceTable
} from '@data/db/schemas/knowledgeChunkGovernance'
import { knowledgeChunkGovernanceService as service } from '@data/services/KnowledgeChunkGovernanceService'
import { KnowledgeChunkHistoryPageSchema } from '@shared/data/types/knowledgeChunkGovernance'

import { knowledgeHandlers } from '../knowledges'

const baseId = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const unitId = 'a'.repeat(64)
const source = {
  baseId,
  itemId,
  unitId,
  sourceContentHash: 'b'.repeat(64),
  charStart: 4,
  charEnd: 12,
  originalText: 'original'
}
const initial = { excluded: true, labels: ['private'], overrideText: 'A recorded correction' }
const handler = knowledgeHandlers['/knowledge-bases/:baseId/items/:itemId/chunks/:unitId/history'].GET
const params = { baseId, itemId, unitId }

describe('owned bounded chunk history reads', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: baseId,
        name: 'Knowledge',
        orderKey: 'a0',
        status: 'completed',
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: itemId,
        baseId,
        type: 'note',
        status: 'completed',
        data: { source: 'Original source', content: 'raw original remains unchanged' }
      })
      .run()
  })
  // A new edit during browsing must not cause older accepted evidence to be skipped or repeated.
  it('returns descending bounded pages while keeping original evidence and surviving newer edits', async () => {
    service.create(source, initial)
    for (let revision = 1; revision < 8; revision++)
      service.updateState({
        ...params,
        sourceContentHash: source.sourceContentHash,
        expectedRevision: revision,
        state: { ...initial, labels: [`label-${revision + 1}`] }
      })
    const before = dbh.db.select().from(knowledgeChunkGovernanceHistoryTable).all()
    const first = KnowledgeChunkHistoryPageSchema.parse(await handler({ params, query: { limit: 5 } }))
    expect(first.items.map((x) => x.revision)).toEqual([8, 7, 6, 5, 4])
    expect(first.nextBeforeRevision).toBe(4)
    expect(first.binding).toMatchObject({
      originalText: 'original',
      charStart: 4,
      charEnd: 12,
      sourceContentHash: source.sourceContentHash,
      retired: false
    })
    expect(first.items[0].state.overrideText).toBe('A recorded correction')
    service.updateState({
      ...params,
      sourceContentHash: source.sourceContentHash,
      expectedRevision: 8,
      state: { ...initial, labels: ['new edit'] }
    })
    const second = KnowledgeChunkHistoryPageSchema.parse(
      await handler({ params, query: { beforeRevision: first.nextBeforeRevision, limit: 5 } })
    )
    expect(second.items.map((x) => x.revision)).toEqual([3, 2, 1])
    expect(second.nextBeforeRevision).toBeUndefined()
    expect(second.binding?.revision).toBe(9)
    expect(dbh.db.select().from(knowledgeChunkGovernanceHistoryTable).all().slice(0, 8)).toEqual(before)
    expect(dbh.db.select().from(knowledgeItemTable).get()?.data).toEqual({
      source: 'Original source',
      content: 'raw original remains unchanged'
    })
  })
  it('keeps retired discard evidence readable without restoring or modifying it', async () => {
    const row = service.create(source, initial)
    service.review({
      baseId,
      itemId,
      governanceId: row.id,
      expectedRevision: 1
    })
    const before = dbh.db.select().from(knowledgeChunkGovernanceTable).get()
    const page = KnowledgeChunkHistoryPageSchema.parse(await handler({ params }))
    expect(page.binding?.retired).toBe(true)
    expect(page.items.map((x) => x.operation)).toEqual(['discard', 'edit'])
    expect(page.items[1].state).toEqual(initial)
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).get()).toEqual(before)
  })
  it('distinguishes untouched chunks from unavailable owners without creating synthetic history', async () => {
    expect(await handler({ params })).toEqual({ binding: null, items: [] })
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toEqual([])
    await expect(handler({ params: { ...params, itemId: '33333333-3333-4333-8333-333333333333' } })).rejects.toThrow()
  })
  it('refuses a mismatched base even when the item and history exist', async () => {
    service.create(source, initial)
    await expect(handler({ params: { ...params, baseId: '33333333-3333-4333-8333-333333333333' } })).rejects.toThrow()
  })
  it('refuses failed, deleting and directory owners before exposing stored text', async () => {
    service.create(source, initial)
    dbh.db
      .update(knowledgeBaseTable)
      .set({ status: 'failed', error: 'missing_vector_store' })
      .where(eq(knowledgeBaseTable.id, baseId))
      .run()
    await expect(handler({ params })).rejects.toThrow()
    dbh.db
      .update(knowledgeBaseTable)
      .set({ status: 'completed', error: null })
      .where(eq(knowledgeBaseTable.id, baseId))
      .run()
    for (const status of ['failed', 'deleting'] as const) {
      dbh.db
        .update(knowledgeItemTable)
        .set({ status, error: status === 'failed' ? 'test failure' : null })
        .where(eq(knowledgeItemTable.id, itemId))
        .run()
      await expect(handler({ params })).rejects.toThrow()
    }
    dbh.db
      .update(knowledgeItemTable)
      .set({ status: 'completed', error: null, type: 'directory' })
      .where(eq(knowledgeItemTable.id, itemId))
      .run()
    await expect(handler({ params })).rejects.toThrow()
  })
  it('honors item deletion ownership rather than leaving readable orphan history', async () => {
    service.create(source, initial)
    dbh.db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, itemId)).run()
    await expect(handler({ params })).rejects.toThrow()
    expect(dbh.db.select().from(knowledgeChunkGovernanceHistoryTable).all()).toEqual([])
  })
  it('rejects unbounded and malformed page parameters rather than widening the read', async () => {
    service.create(source, initial)
    for (const query of [
      { limit: 0 },
      { limit: 26 },
      { beforeRevision: 0 },
      { beforeRevision: 1.5 },
      { limit: 5, extra: 'not allowed' }
    ])
      await expect(handler({ params, query })).rejects.toThrow()
    await expect(handler({ params: { ...params, unitId: 'bad' } })).rejects.toThrow()
    expect(
      KnowledgeChunkHistoryPageSchema.parse(await handler({ params, query: { beforeRevision: 1 } })).items
    ).toEqual([])
  })
  it('preserves transfer links, retired origins and restore operations as separate immutable evidence', async () => {
    const old = service.create(source, initial)
    const target = {
      ...source,
      unitId: 'c'.repeat(64),
      sourceContentHash: 'd'.repeat(64),
      charStart: 0,
      charEnd: 11,
      originalText: 'replacement'
    }
    service.review({
      baseId,
      itemId,
      governanceId: old.id,
      expectedRevision: 1,
      target: { source: target, expectedRevision: 0 }
    })
    const from = KnowledgeChunkHistoryPageSchema.parse(await handler({ params }))
    const to = KnowledgeChunkHistoryPageSchema.parse(await handler({ params: { ...params, unitId: target.unitId } }))
    expect(from.binding?.retired).toBe(true)
    expect(from.items[0]).toMatchObject({ operation: 'rebind-away', relatedGovernanceId: to.binding?.id })
    expect(to.items[0]).toMatchObject({ operation: 'rebind-from', relatedGovernanceId: old.id, state: initial })
    expect(from.binding?.originalText).toBe('original')
    expect(to.binding?.originalText).toBe('replacement')
    service.review({ baseId, itemId, governanceId: to.binding!.id, expectedRevision: to.binding!.revision })
    service.restoreDiscard({ baseId, itemId, governanceId: to.binding!.id, expectedRevision: to.binding!.revision + 1 })
    const restored = KnowledgeChunkHistoryPageSchema.parse(
      await handler({ params: { ...params, unitId: target.unitId } })
    )
    expect(restored.items.map((x) => x.operation)).toEqual(['restore-discard', 'discard', 'rebind-from'])
    expect(restored.items[0].state).toEqual(initial)
    expect(restored.binding?.retired).toBe(false)
    expect(from.items[0].operation).toBe('rebind-away')
  })
})

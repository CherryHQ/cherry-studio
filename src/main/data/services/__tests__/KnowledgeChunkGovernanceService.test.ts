import { createHash } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import {
  knowledgeChunkGovernanceHistoryTable,
  knowledgeChunkGovernanceTable
} from '@data/db/schemas/knowledgeChunkGovernance'
import { KnowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import type { KnowledgeChunkGovernanceSource } from '@shared/data/types/knowledgeChunkGovernance'

const baseId = '11111111-1111-4111-8111-111111111111'
const itemId = '0198f3f2-7d1a-7abc-8def-123456789abc'
const source: KnowledgeChunkGovernanceSource = {
  baseId,
  itemId,
  unitId: 'a'.repeat(64),
  sourceContentHash: 'b'.repeat(64),
  charStart: 4,
  charEnd: 15,
  originalText: 'bad OCR é😀'
}
const state = { excluded: true, labels: ['review'], overrideText: 'Corrected text of a different length' }

describe('KnowledgeChunkGovernanceService', () => {
  const dbh = setupTestDatabase()
  const service = new KnowledgeChunkGovernanceService()
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
        data: { source: 'Source note', content: 'raw original remains here' }
      })
      .run()
  })

  // Protects the durable evidence from being replaced by effective correction text or transient connection state.
  it('preserves original offsets/text and normalized decisions across a new database connection', () => {
    const saved = service.create(source, { ...state, labels: [' review ', 'review', 'OCR'] })
    expect(saved.state).toEqual({ ...state, labels: ['OCR', 'review'] })
    expect(saved.originalTextHash).toBe(createHash('sha256').update(source.originalText).digest('hex'))
    const connection = new Database(dbh.sqlite.name)
    try {
      const db = drizzle({ client: connection, casing: 'snake_case' })
      expect(db.select().from(knowledgeChunkGovernanceTable).get()).toEqual(saved)
      expect(
        db
          .select()
          .from(knowledgeChunkGovernanceHistoryTable)
          .all()
          .map((row) => row.state)
      ).toEqual([saved.state])
    } finally {
      connection.close()
    }
    expect(dbh.db.select().from(knowledgeItemTable).get()?.data).toEqual({
      source: 'Source note',
      content: 'raw original remains here'
    })
  })

  // Protects against a concurrent window losing labels/corrections when it re-enables a chunk.
  it('rejects stale revisions and source identity while retaining every committed decision', () => {
    service.create(source, state)
    const input = {
      baseId,
      itemId,
      unitId: source.unitId,
      sourceContentHash: source.sourceContentHash,
      expectedRevision: 1,
      state: { ...state, excluded: false }
    }
    const updated = service.updateState(input)
    expect(updated.state).toEqual({ ...state, excluded: false })
    expect(updated.revision).toBe(2)
    expect(() => service.updateState({ ...input, state: { ...state, labels: ['stale'] } })).toThrow(/revision changed/)
    expect(() => service.updateState({ ...input, expectedRevision: 2, sourceContentHash: 'c'.repeat(64) })).toThrow(
      /revision changed/
    )
    expect(service.get(baseId, itemId, source.unitId)).toEqual(updated)
    expect(
      service
        .listHistory(baseId, itemId, source.unitId)
        .map(({ revision, state: value }) => ({ revision, state: value }))
    ).toEqual([
      { revision: 1, state },
      { revision: 2, state: { ...state, excluded: false } }
    ])
    expect(updated.originalText).toBe(source.originalText)
    expect(updated.charEnd).toBe(source.charEnd)
  })

  it('records override removal and treats an identical normalized save as a no-op', () => {
    service.create(source, state)
    const update = {
      baseId,
      itemId,
      unitId: source.unitId,
      sourceContentHash: source.sourceContentHash,
      expectedRevision: 1,
      state: { ...state, overrideText: null }
    }
    expect(service.updateState(update).state).toEqual({ ...state, overrideText: null })
    expect(service.updateState({ ...update, expectedRevision: 2 }).revision).toBe(2)
    expect(service.listHistory(baseId, itemId, source.unitId)).toHaveLength(2)
  })

  // A history failure must roll back the effective record too, not leave an unaudited state.
  it('rolls back both create and update if the history insert fails', () => {
    const failHistory = () =>
      dbh.sqlite.exec(
        `CREATE TEMP TRIGGER fail_governance_history BEFORE INSERT ON knowledge_chunk_governance_history BEGIN SELECT RAISE(ABORT, 'history write failed'); END;`
      )
    failHistory()
    try {
      expect(() => service.create(source, state)).toThrow()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_governance_history')
    }
    expect(service.get(baseId, itemId, source.unitId)).toBeUndefined()
    const original = service.create(source, state)
    failHistory()
    try {
      expect(() =>
        service.updateState({
          baseId,
          itemId,
          unitId: source.unitId,
          sourceContentHash: source.sourceContentHash,
          expectedRevision: 1,
          state: { ...state, excluded: false }
        })
      ).toThrow()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_governance_history')
    }
    expect(service.get(baseId, itemId, source.unitId)).toEqual(original)
    expect(service.listHistory(baseId, itemId, source.unitId)).toHaveLength(1)
  })

  it('rejects cross-base, missing, directory and unfinished source bindings', () => {
    expect(() => service.create({ ...source, baseId: '22222222-2222-4222-8222-222222222222' }, state)).toThrow(
      /not found/i
    )
    expect(() => service.create({ ...source, itemId: '0198f3f2-7d1b-7abc-8def-123456789abc' }, state)).toThrow(
      /not found/i
    )
    dbh.db.update(knowledgeItemTable).set({ status: 'reading' }).where(eq(knowledgeItemTable.id, itemId)).run()
    expect(() => service.create(source, state)).toThrow(/completed source/)
    dbh.db
      .update(knowledgeItemTable)
      .set({ type: 'directory', status: 'completed', data: { source: '/directory' } })
      .where(eq(knowledgeItemTable.id, itemId))
      .run()
    expect(() => service.create(source, state)).toThrow(/completed source/)
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toHaveLength(0)
  })

  it('rejects invalid original ranges and empty corrections before any write', () => {
    expect(() => service.create({ ...source, charEnd: source.charEnd + 1 }, state)).toThrow(/offset range/)
    expect(() => service.create(source, { ...state, overrideText: '' })).toThrow()
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toHaveLength(0)
  })

  it('keeps source scoping on reads and cascades owned history when the item is permanently deleted', () => {
    service.create(source, state)
    expect(service.get('other-base', itemId, source.unitId)).toBeUndefined()
    expect(service.listHistory(baseId, 'other-item', source.unitId)).toEqual([])
    expect(() => service.create(source, state)).toThrow(/already exists/)
    dbh.db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, itemId)).run()
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toEqual([])
    expect(dbh.db.select().from(knowledgeChunkGovernanceHistoryTable).all()).toEqual([])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

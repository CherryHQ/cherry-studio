import { setupTestDatabase } from '@test-helpers/db'
import { and, eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { knowledgeItemService as service } from '@data/services/KnowledgeItemService'
import { loadVisibleItems } from '@main/features/knowledge/query/visibility'
import type { ListKnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import { createUniqueModelId } from '@shared/data/types/model'

const BASE = '11111111-1111-4111-8111-111111111111'
const OTHER_BASE = '22222222-2222-4222-8222-222222222222'
const MARKER = 'One or more child items failed'
const id = (n: number) => `0198f3f2-${n.toString(16).padStart(4, '0')}-7abc-8def-123456789abc`

describe('KnowledgeItemService container convergence', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId('openai', 'text-embedding-3-large'),
        providerId: 'openai',
        modelId: 'text-embedding-3-large',
        presetModelId: 'text-embedding-3-large',
        name: 'embed',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0'
      })
      .run()
    for (const baseId of [BASE, OTHER_BASE]) {
      dbh.db
        .insert(knowledgeBaseTable)
        .values({
          id: baseId,
          name: 'KB',
          orderKey: baseId === BASE ? 'a0' : 'a1',
          dimensions: 1024,
          embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
          status: 'completed',
          error: null,
          chunkSize: 1024,
          chunkOverlap: 200
        })
        .run()
    }
  })

  function seedItem(overrides: Partial<typeof knowledgeItemTable.$inferInsert> = {}) {
    return dbh.db
      .insert(knowledgeItemTable)
      .values({
        baseId: BASE,
        type: 'note',
        data: { source: 'same', content: 'content' },
        status: 'completed',
        error: null,
        createdAt: 1000,
        updatedAt: 1000,
        ...overrides
      })
      .returning()
      .get()
  }

  function directory(n: number, groupId: string | null = null, error: string | null = MARKER) {
    return seedItem({
      id: id(n),
      groupId,
      type: 'directory',
      data: { source: '/same' },
      status: error ? 'failed' : 'completed',
      error
    })
  }

  function rows() {
    return dbh.sqlite.prepare('SELECT * FROM knowledge_item ORDER BY id').all()
  }

  function changes() {
    return (dbh.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n
  }

  function list(query: ListKnowledgeItemsQuery = { limit: 100 }) {
    return service.list(BASE, query)
  }

  it.each([false, true])('A1 converges in the recorded selected order, nested first=%s', (nestedFirst) => {
    const root = directory(10)
    const sub = directory(11, root.id)
    seedItem({ id: id(12), groupId: root.id })
    seedItem({ id: id(13), groupId: sub.id })
    const direct = seedItem({ id: id(nestedFirst ? 61 : 60), groupId: root.id, status: 'failed', error: 'bad' })
    const nested = seedItem({ id: id(nestedFirst ? 60 : 61), groupId: sub.id, status: 'failed', error: 'bad' })
    service.setSubtreeStatus(BASE, [direct.id, nested.id], 'deleting')
    const selected = dbh.db
      .select({ id: knowledgeItemTable.id, groupId: knowledgeItemTable.groupId })
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, BASE), inArray(knowledgeItemTable.id, [nested.id, direct.id])))
      .all()
    expect(selected.map((row) => row.groupId)).toEqual(nestedFirst ? [sub.id, root.id] : [root.id, sub.id])
    const visited: string[] = []
    dbh.sqlite.function('record_container_visit', (value: string) => {
      visited.push(value)
      return 0
    })
    dbh.sqlite.exec(`CREATE TEMP TRIGGER record_container_visit AFTER UPDATE ON knowledge_item
      WHEN new.type = 'directory' BEGIN SELECT record_container_visit(new.id); END`)
    try {
      service.deleteItemsByIds(BASE, [nested.id, direct.id])
    } finally {
      dbh.sqlite.exec('DROP TRIGGER record_container_visit')
    }
    const remaining = service.getItemsByBaseId(BASE)
    expect(remaining).toHaveLength(4)
    expect(remaining.every((row) => row.status === 'completed' && row.error === null)).toBe(true)
    expect(visited.filter((value, index) => value !== visited[index - 1])).toEqual(
      nestedFirst ? [sub.id, root.id] : [root.id, sub.id, root.id]
    )
  })

  it.each([false, true])('A2 handles duplicates, independent branches and extra depth, reversed=%s', (reversed) => {
    const top = directory(1)
    const root = directory(2, top.id)
    const sub = directory(3, root.id)
    const other = directory(4, top.id)
    for (const parent of [root, sub, other]) seedItem({ groupId: parent.id })
    const targets = [root, sub, other].map(
      (parent, index) => seedItem({ id: id(60 + index), groupId: parent.id, status: 'failed', error: 'bad' }).id
    )
    service.setSubtreeStatus(BASE, targets, 'deleting')
    const args = reversed ? [...targets].reverse() : targets
    service.deleteItemsByIds(BASE, [...args, ...args])
    expect(service.getItemsByBaseId(BASE).every((row) => row.status === 'completed' && row.error === null)).toBe(true)
  })

  it('A3/B active child wins over multiple failed children in both repair and mutation', () => {
    const root = directory(1)
    const active = seedItem({ groupId: root.id, status: 'embedding' })
    seedItem({ groupId: root.id, status: 'failed', error: 'bad 1' })
    seedItem({ groupId: root.id, status: 'failed', error: 'bad 2' })
    list()
    expect(service.getById(root.id)).toMatchObject({ status: 'processing', error: null })
    service.updateStatus(active.id, 'reading')
    expect(service.getById(root.id)).toMatchObject({ status: 'processing', error: null })
  })

  it('B1 repairs independently persisted nested candidates durably, bottom-up', () => {
    const root = directory(1)
    const sub = directory(2, root.id)
    seedItem({ groupId: sub.id })
    expect(service.getById(root.id)).toMatchObject({ status: 'failed', error: MARKER })
    const result = list()
    expect(result.items.filter((row) => row.type === 'directory').map((row) => row.status)).toEqual([
      'completed',
      'completed'
    ])
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, root.id)).get()).toMatchObject({
      status: 'completed',
      error: null
    })
    for (const parent of [root, sub]) {
      expect(service.getById(parent.id)).toMatchObject({ status: 'completed', error: null })
    }
  })

  it('B2 healthy, truthful and repeated reads issue no updates or timestamp changes', () => {
    directory(1, null, null)
    const noCandidates = vi.spyOn(application.get('DbService'), 'withWriteTx')
    const beforeHealthy = rows()
    let beforeChanges = changes()
    list()
    expect(changes() - beforeChanges).toBe(0)
    expect(rows()).toEqual(beforeHealthy)
    expect(noCandidates).not.toHaveBeenCalled()
    noCandidates.mockRestore()
    const root = directory(2)
    seedItem({ groupId: root.id, status: 'failed', error: 'genuine' })
    const beforeTruthful = rows()
    const updates = vi.spyOn(dbh.db, 'update')
    beforeChanges = changes()
    list()
    list()
    expect(changes() - beforeChanges).toBe(0)
    expect(rows()).toEqual(beforeTruthful)
    expect(updates).not.toHaveBeenCalled()
    updates.mockRestore()
  })

  it('B2 repeated reads after repair leave every row unchanged', () => {
    const stale = directory(3)
    list()
    expect(service.getById(stale.id).status).toBe('completed')
    const repaired = rows()
    const beforeChanges = changes()
    list()
    expect(changes() - beforeChanges).toBe(0)
    expect(rows()).toEqual(repaired)
  })

  it('B3 preserves intrinsic failures byte-for-byte with green children and without children', () => {
    for (const [index, error] of [
      'arbitrary message',
      'indexing_interrupted',
      'directory_not_migrated',
      'Directory contains no indexable files'
    ].entries()) {
      const parent = directory(index + 1, null, error)
      const child = directory(index + 11, parent.id)
      seedItem({ groupId: parent.id })
      directory(index + 21, null, error)
      seedItem({ groupId: child.id })
    }
    const protectedRows = rows().filter((row) => (row as { error: string }).error !== MARKER)
    list()
    for (const original of protectedRows) expect(rows()).toContainEqual(original)
  })

  it('B4 preserves marker leaves, other bases/statuses and near matches exactly', () => {
    seedItem({ status: 'failed', error: MARKER })
    seedItem({ type: 'directory', data: { source: '/other' }, baseId: OTHER_BASE, status: 'failed', error: MARKER })
    // Legacy non-failed marker rows violate today's CHECK; seed only this corruption explicitly.
    dbh.sqlite.pragma('ignore_check_constraints = ON')
    try {
      for (const status of ['completed', 'processing', 'preparing', 'deleting'] as const) {
        seedItem({ type: 'directory', data: { source: '/other' }, status, error: MARKER })
      }
    } finally {
      dbh.sqlite.pragma('ignore_check_constraints = OFF')
    }
    directory(1, null, MARKER.toLowerCase())
    directory(2, null, `${MARKER} `)
    const before = rows()
    const count = changes()
    list({ limit: 100, type: 'file' })
    expect(rows()).toEqual(before)
    expect(changes() - count).toBe(0)
    dbh.sqlite.prepare("UPDATE knowledge_item SET error = NULL WHERE status != 'failed'").run()
  })

  it.each([
    { limit: 1, type: 'file' as const },
    { limit: 1, groupId: id(99) }
  ])('B5 repairs across the base outside listing filter %j', (query) => {
    const root = directory(1)
    const sub = directory(2, root.id)
    seedItem({ groupId: sub.id })
    expect(list(query).items).toEqual([])
    expect(service.getById(root.id)).toMatchObject({ status: 'completed', error: null })
    expect(service.getById(sub.id)).toMatchObject({ status: 'completed', error: null })
  })

  it.each(
    (['name', 'type', 'status', 'updatedAt'] as const).flatMap((sortBy) =>
      (['asc', 'desc'] as const).map((sortOrder) => ({ sortBy, sortOrder }))
    )
  )('B6 paginates post-repair tied $sortBy $sortOrder', ({ sortBy, sortOrder }) => {
    dbh.sqlite.prepare('DELETE FROM knowledge_item').run()
    const parents = [directory(1), directory(2), directory(3)]
    for (const parent of parents) seedItem({ groupId: parent.id })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000)
    try {
      const seen: string[] = []
      let cursor: string | undefined
      let first = true
      do {
        const before = changes()
        const page = list({ limit: 1, type: 'directory', sortBy, sortOrder, cursor })
        expect(changes() - before).toBe(first ? 3 : 0)
        expect(page.total).toBe(3)
        expect(page.items).toHaveLength(1)
        expect(page.items[0]).toMatchObject({ status: 'completed', error: null })
        expect(Date.parse(page.items[0].updatedAt)).toBe(10000)
        seen.push(page.items[0].id)
        if (page.nextCursor) {
          const decoded = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8'))
          expect(decoded).toMatchObject({ sortBy, sortOrder, id: page.items[0].id })
          const expectedKey = sortBy === 'name' ? 'same' : sortBy === 'type' ? 0 : sortBy === 'status' ? 5 : 10000
          expect(decoded.key).toBe(expectedKey)
        }
        cursor = page.nextCursor
        first = false
        expect(seen.length).toBeLessThanOrEqual(3)
      } while (cursor)
      expect(seen).toEqual(parents.map((row) => row.id))
      expect(new Set(seen).size).toBe(3)
    } finally {
      clock.mockRestore()
    }
  })

  it('B7 rolls back an earlier repair if a later update fails, then retries', () => {
    const root = directory(1)
    const sub = directory(2, root.id)
    seedItem({ groupId: sub.id })
    const before = rows()
    dbh.sqlite.exec(`CREATE TEMP TRIGGER reject_later_repair BEFORE UPDATE ON knowledge_item
      WHEN old.id = '${root.id}' BEGIN SELECT RAISE(ABORT, 'later repair failed'); END`)
    const beforeChanges = changes()
    try {
      expect(() => list()).toThrow('later repair failed')
      expect(changes() - beforeChanges).toBe(1)
      expect(rows()).toEqual(before)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_later_repair')
    }
    list()
    expect(service.getById(root.id)).toMatchObject({ status: 'completed', error: null })
    expect(service.getById(sub.id)).toMatchObject({ status: 'completed', error: null })
  })

  it('B8 completed leaves remain visible below intrinsic failures; failed leaves stay excluded', () => {
    const root = directory(1, null, 'indexing_interrupted')
    const green = seedItem({ groupId: root.id })
    const failed = seedItem({ groupId: root.id, status: 'failed', error: 'bad' })
    list()
    expect([...loadVisibleItems(BASE, [green.id, failed.id]).keys()]).toEqual([green.id])
    expect(service.getById(root.id)).toMatchObject({ status: 'failed', error: 'indexing_interrupted' })
  })

  it('repairs empty candidates and candidates containing only deleting children', () => {
    const empty = directory(1)
    const deletingOnly = directory(2)
    seedItem({ groupId: deletingOnly.id, status: 'deleting' })
    list()
    for (const parent of [empty, deletingOnly])
      expect(service.getById(parent.id)).toMatchObject({ status: 'completed', error: null })
  })
})

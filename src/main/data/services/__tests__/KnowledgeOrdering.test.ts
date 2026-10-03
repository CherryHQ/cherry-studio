import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeBaseOrderSeeder } from '@data/db/seeding/seeders/knowledgeBaseOrderSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { groupService } from '@data/services/GroupService'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { KnowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeItemSort, ListKnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import { PosixRelativeFilePathSchema } from '@shared/utils/file'

const groupA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const groupB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherGroup = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// A failed cross-group reorder must leave the base in its original group and position.
describe('Knowledge ordering contracts', () => {
  const dbh = setupTestDatabase()
  const bases = new KnowledgeBaseService()
  const items = new KnowledgeItemService()

  beforeEach(() => {
    dbh.db
      .insert(groupTable)
      .values([
        { id: groupA, entityType: 'knowledge', name: 'A', orderKey: 'a0' },
        { id: groupB, entityType: 'knowledge', name: 'B', orderKey: 'a1' },
        { id: otherGroup, entityType: 'assistant', name: 'Other', orderKey: 'a0' }
      ])
      .run()
  })

  function createBase(name: string, groupId?: string) {
    return bases.create({ name, groupId })
  }

  function ordered(groupId: string | null) {
    return bases
      .listCursor({ limit: 100, sortBy: 'orderKey', sortOrder: 'asc' })
      .items.filter((base) => base.groupId === groupId)
      .map((base) => base.name)
  }

  it('creates at the front, reorders within a group and persists an atomic cross-group move', () => {
    const first = createBase('First', groupA)
    const second = createBase('Second', groupA)
    const target = createBase('Target', groupB)
    expect(ordered(groupA)).toEqual(['Second', 'First'])
    bases.reorder(first.id, { anchor: { before: second.id } })
    expect(ordered(groupA)).toEqual(['First', 'Second'])
    bases.reorder(first.id, { groupId: groupB, anchor: { after: target.id } })
    expect(new KnowledgeBaseService().getById(first.id).groupId).toBe(groupB)
    expect(ordered(groupB)).toEqual(['Target', 'First'])
    bases.reorder(first.id, { groupId: null, anchor: { position: 'last' } })
    expect(ordered(null)).toEqual(['First'])
  })

  it('uses visible anchors without rearranging hidden search results', () => {
    const last = createBase('Visible last', groupA)
    createBase('Hidden second', groupA)
    const first = createBase('Visible first', groupA)
    createBase('Hidden first', groupA)
    bases.reorder(last.id, { anchor: { before: first.id } })
    expect(ordered(groupA)).toEqual(['Hidden first', 'Visible last', 'Visible first', 'Hidden second'])
  })

  it('rejects an anchor outside the target group and rolls back the group change', () => {
    const base = createBase('Base', groupA)
    const anchor = createBase('Wrong anchor', groupA)
    const before = bases.getById(base.id)
    expect(() => bases.reorder(base.id, { groupId: groupB, anchor: { before: anchor.id } })).toThrow()
    expect(bases.getById(base.id)).toEqual(before)
    expect(() => bases.reorder(base.id, { groupId: otherGroup, anchor: { position: 'last' } })).toThrow()
    expect(() => bases.reorder(base.id, { anchor: { before: base.id } })).toThrow()
    expect(bases.getById(base.id)).toEqual(before)
  })

  it('appends menu moves to the destination and leaves siblings ordered', () => {
    const moving = createBase('Moving', groupA)
    createBase('First target', groupB)
    createBase('Second target', groupB)
    bases.update(moving.id, { groupId: groupB })
    expect(ordered(groupB)).toEqual(['Second target', 'First target', 'Moving'])
  })

  it('appends deleted-group bases in order and can insert between formerly equal keys', () => {
    const first = createBase('Ungrouped')
    const last = createBase('Group last', groupA)
    createBase('Group first', groupA)
    const other = createBase('Other group', groupB)
    expect(first.orderKey).toBe(last.orderKey)

    groupService.delete(groupA)
    expect(ordered(null)).toEqual(['Ungrouped', 'Group first', 'Group last'])
    expect(bases.getById(other.id).groupId).toBe(groupB)
    bases.reorder(last.id, { anchor: { after: first.id } })
    expect(ordered(null)).toEqual(['Ungrouped', 'Group last', 'Group first'])
  })

  it('rolls back regrouping and ordering when deleting the group fails', () => {
    const base = createBase('Grouped', groupA)
    createBase('Ungrouped')
    dbh.sqlite.exec(`CREATE TRIGGER reject_group_delete BEFORE DELETE ON "group"
      BEGIN SELECT RAISE(ABORT, 'delete rejected'); END`)
    try {
      expect(() => groupService.delete(groupA)).toThrow()
      expect(bases.getById(base.id)).toEqual(base)
      expect(ordered(null)).toEqual(['Ungrouped'])
      expect(groupService.getById(groupA).name).toBe('A')
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_group_delete')
    }
  })

  it('initializes old order once without changing metadata or later user order', () => {
    const a = createBase('Old', groupA)
    const b = createBase('New', groupA)
    dbh.db
      .update(knowledgeBaseTable)
      .set({ createdAt: 1000, updatedAt: 1234, orderKey: 'a0' })
      .where(eq(knowledgeBaseTable.id, a.id))
      .run()
    dbh.db
      .update(knowledgeBaseTable)
      .set({ createdAt: 2000, updatedAt: 2345, orderKey: 'a0' })
      .where(eq(knowledgeBaseTable.id, b.id))
      .run()
    const runner = new SeedRunner(dbh.db)
    runner.runAll([new KnowledgeBaseOrderSeeder()])
    expect(ordered(groupA)).toEqual(['New', 'Old'])
    expect(bases.getById(a.id).updatedAt).toBe(new Date(1234).toISOString())
    bases.reorder(a.id, { anchor: { before: b.id } })
    runner.runAll([new KnowledgeBaseOrderSeeder()])
    expect(ordered(groupA)).toEqual(['Old', 'New'])
  })

  function insertItem(baseId: string, index: number, overrides: Partial<typeof knowledgeItemTable.$inferInsert> = {}) {
    const id = `0198f3f2-${index.toString(16).padStart(4, '0')}-7abc-8def-123456789abc`
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id,
        baseId,
        type: 'note',
        data: { source: `Title ${index}`, content: 'Body' },
        status: 'completed',
        createdAt: index * 1000,
        updatedAt: index * 1000,
        ...overrides
      })
      .run()
    return id
  }

  function readAll(baseId: string, query: Omit<ListKnowledgeItemsQuery, 'limit'>, limit = 3) {
    const result: string[] = []
    let cursor: string | undefined
    do {
      const page = items.list(baseId, { ...query, limit, cursor })
      result.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    return result
  }

  it('sorts actual display names across all types, ignoring case with stable ties', () => {
    const base = createBase('Names')
    const first = insertItem(base.id, 1, {
      type: 'file',
      data: { source: '/z.pdf', relativePath: PosixRelativeFilePathSchema.parse('Alpha.pdf') }
    })
    const second = insertItem(base.id, 2, {
      type: 'note',
      data: {
        source: 'Different title',
        content: 'Body',
        relativePath: PosixRelativeFilePathSchema.parse('alpha.pdf.md')
      }
    })
    const third = insertItem(base.id, 3, {
      type: 'url',
      data: {
        source: 'https://z.example',
        url: 'https://z.example',
        relativePath: PosixRelativeFilePathSchema.parse('Beta.md')
      }
    })
    const fourth = insertItem(base.id, 4, {
      type: 'directory',
      data: { source: '/z', relativePath: PosixRelativeFilePathSchema.parse('中文') }
    })
    expect(readAll(base.id, { sortBy: 'name', sortOrder: 'asc' }, 1)).toEqual([first, second, third, fourth])
    expect(readAll(base.id, { sortBy: 'name', sortOrder: 'desc' }, 1)).toEqual([fourth, third, first, second])
    expect(readAll(base.id, {}, 1)[0]).toBe(fourth)
  })

  it.each(['asc', 'desc'] as const)(
    'paginates more than two pages by name, type, status and time (%s)',
    (sortOrder) => {
      const base = createBase('Large')
      const ids: string[] = []
      const statuses = ['idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'failed'] as const
      for (let index = 0; index < 123; index++) {
        const rank = index % 7
        const status = statuses[rank]
        const type = status === 'preparing' ? 'directory' : index % 3 === 0 ? 'url' : index % 3 === 1 ? 'file' : 'note'
        const data =
          type === 'directory'
            ? { source: '/dir' }
            : type === 'url'
              ? { source: 'https://example.com', url: 'https://example.com' }
              : type === 'file'
                ? { source: '/file.pdf', relativePath: PosixRelativeFilePathSchema.parse('file.pdf') }
                : { source: 'Note', content: 'Body' }
        ids.push(
          insertItem(base.id, index + 1, {
            type,
            data,
            status,
            error: status === 'failed' ? 'Failed' : null,
            updatedAt: rank * 1000
          })
        )
      }
      for (const sortBy of ['name', 'type', 'status', 'updatedAt'] as const) {
        const rows = readAll(base.id, { sortBy, sortOrder }, 50)
        expect(rows).toHaveLength(123)
        expect(new Set(rows)).toEqual(new Set(ids))
        const values = rows.map((id) => items.getById(id))
        const ranks = values.map((item) =>
          sortBy === 'name'
            ? item.type === 'directory'
              ? 'dir'
              : item.type === 'file'
                ? 'file.pdf'
                : item.type === 'note'
                  ? 'note'
                  : 'https://example.com'
            : sortBy === 'type'
              ? ['directory', 'file', 'note', 'url'].indexOf(item.type)
              : sortBy === 'status'
                ? statuses.indexOf(item.status as (typeof statuses)[number])
                : Date.parse(item.updatedAt)
        )
        for (let i = 1; i < ranks.length; i++) {
          expect(sortOrder === 'asc' ? ranks[i] >= ranks[i - 1] : ranks[i] <= ranks[i - 1]).toBe(true)
          if (ranks[i] === ranks[i - 1]) expect(rows[i] > rows[i - 1]).toBe(true)
        }
      }
    }
  )

  it('starts a new sort without reusing a cursor from another column or direction', () => {
    const base = createBase('Cursor')
    const older = insertItem(base.id, 1)
    const newer = insertItem(base.id, 2)
    const sort: KnowledgeItemSort = { sortBy: 'updatedAt', sortOrder: 'desc' }
    const first = items.list(base.id, { limit: 1, ...sort })
    expect(first.items[0].id).toBe(newer)
    expect(items.list(base.id, { limit: 1, ...sort, sortOrder: 'asc', cursor: first.nextCursor }).items[0].id).toBe(
      older
    )
  })
})

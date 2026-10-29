import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { fileEntryTable } from '@data/db/schemas/file'
import { translateHistoryFileRefTable } from '@data/db/schemas/fileRelations'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateHistoryService } from '@data/services/TranslateHistoryService'
import type { CreateTranslateHistoryDto, UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'

describe('TranslateHistoryService', () => {
  const dbh = setupTestDatabase()

  async function seedHistory(overrides: Partial<typeof translateHistoryTable.$inferInsert> = {}) {
    const values: typeof translateHistoryTable.$inferInsert = {
      id: '019606a0-0000-7000-8000-000000000000',
      sourceText: 'Hello',
      targetText: 'Bonjour',
      sourceLanguage: null,
      targetLanguage: null,
      star: false,
      createdAt: 1000,
      updatedAt: 1000,
      ...overrides
    }
    await dbh.db.insert(translateHistoryTable).values(values)
    return values
  }

  const TRANSLATED_ENTRY_ID = '019606a0-0000-7000-8000-000000000001'
  const SOURCE_ENTRY_ID = '019606a0-0000-7000-8000-000000000002'

  async function seedFileEntries() {
    const now = 1000
    await dbh.db.insert(fileEntryTable).values([
      {
        id: TRANSLATED_ENTRY_ID,
        origin: 'internal',
        name: 'paper.zh-CN',
        ext: 'pdf',
        size: 2048,
        cleanupPolicy: 'delete_when_unreferenced',
        createdAt: now,
        updatedAt: now
      },
      {
        id: SOURCE_ENTRY_ID,
        origin: 'external',
        name: 'paper',
        ext: 'pdf',
        externalPath: '/tmp/paper.pdf',
        cleanupPolicy: 'delete_when_unreferenced',
        createdAt: now,
        updatedAt: now
      }
    ])
  }

  function createFileHistory(includeSource = true) {
    return translateHistoryService.createFileTx(dbh.db, {
      sourceText: 'paper.pdf',
      targetText: 'paper.zh-CN.pdf',
      sourceLanguage: null,
      targetLanguage: null,
      targetFileEntryId: TRANSLATED_ENTRY_ID,
      ...(includeSource ? { sourceFileEntryId: SOURCE_ENTRY_ID } : {})
    })
  }

  describe('list', () => {
    it('should return cursor paginated results with defaults', async () => {
      await seedHistory()

      const result = translateHistoryService.list({ limit: 20 })
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.nextCursor).toBeUndefined()
    })

    it('should return empty results', async () => {
      const result = translateHistoryService.list({ limit: 20 })
      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
      expect(result.nextCursor).toBeUndefined()
    })

    it('should page by createdAt and id cursor', async () => {
      const newest = await seedHistory({
        id: '019606a0-0000-7000-8000-000000000010',
        createdAt: 3000,
        updatedAt: 3000
      })
      const middle = await seedHistory({
        id: '019606a0-0000-7000-8000-000000000011',
        createdAt: 2000,
        updatedAt: 2000
      })
      const oldest = await seedHistory({
        id: '019606a0-0000-7000-8000-000000000012',
        createdAt: 1000,
        updatedAt: 1000
      })

      const firstPage = translateHistoryService.list({ limit: 2 })
      expect(firstPage.items.map((item) => item.id)).toEqual([newest.id, middle.id])
      expect(firstPage.nextCursor).toBe(`${middle.createdAt}:${middle.id}`)

      const secondPage = translateHistoryService.list({ cursor: firstPage.nextCursor, limit: 2 })
      expect(secondPage.items.map((item) => item.id)).toEqual([oldest.id])
      expect(secondPage.nextCursor).toBeUndefined()
    })

    it('should search by text', async () => {
      await seedHistory({ sourceText: 'Hello world' })
      await seedHistory({ id: '019606a0-0000-7000-8000-000000000001', sourceText: 'Goodbye' })

      const result = translateHistoryService.list({ limit: 20, search: 'Hello' })
      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.some((i) => i.sourceText.includes('Hello'))).toBe(true)
    })

    it('should escape LIKE wildcards in search', async () => {
      const matching = await seedHistory({ sourceText: '100% off_sale\\test' })
      await seedHistory({ id: '019606a0-0000-7000-8000-000000000009', sourceText: '1000 offXsale/test' })

      const result = translateHistoryService.list({ limit: 20, search: '100% off_sale\\test' })
      expect(result.items.map((item) => item.id)).toEqual([matching.id])
      expect(result.total).toBe(1)
    })

    it('should filter by star', async () => {
      await seedHistory({ star: true })
      await seedHistory({ id: '019606a0-0000-7000-8000-000000000002', star: false })

      const result = translateHistoryService.list({ limit: 20, star: true })
      expect(result.items.every((i) => i.star === true)).toBe(true)
    })
  })

  describe('getById', () => {
    it('should return a translate history by id', async () => {
      const seeded = await seedHistory()

      const result = translateHistoryService.getById(seeded.id!)
      expect(result.id).toBe(seeded.id)
      expect(result.sourceText).toBe('Hello')
      expect(result.targetText).toBe('Bonjour')
    })

    it('should throw NotFound for non-existent id', async () => {
      expect(() => translateHistoryService.getById('non-existent')).toThrow()
    })

    it('should reject an invalid persisted history kind at the read boundary', async () => {
      const seeded = await seedHistory({ kind: 'corrupt' as never })

      expect(() => translateHistoryService.getById(seeded.id!)).toThrow(ZodError)
    })
  })

  describe('create', () => {
    it('should validate and create a translate history', async () => {
      const dto: CreateTranslateHistoryDto = {
        sourceText: 'Hello',
        targetText: 'Bonjour',
        sourceLanguage: null,
        targetLanguage: null
      }

      const result = translateHistoryService.create(dto)
      expect(result.sourceText).toBe('Hello')
      expect(result.archived).toBe(false)

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe('text')
      expect(rows[0].archived).toBe(false)
    })
  })

  describe('createFileTx', () => {
    it('should write the history row and both file refs', async () => {
      await seedFileEntries()

      const created = createFileHistory()

      expect(created.kind).toBe('file')
      expect(created.archived).toBe(false)
      expect(dbh.db.select().from(translateHistoryTable).get()?.archived).toBe(false)
      const refs = await dbh.db.select().from(translateHistoryFileRefTable)
      expect(refs.map((ref) => [ref.role, ref.fileEntryId, ref.sourceId])).toEqual([
        ['target', TRANSLATED_ENTRY_ID, created.id],
        ['source', SOURCE_ENTRY_ID, created.id]
      ])
    })

    it('should write the required target without an optional source', async () => {
      await seedFileEntries()

      const created = createFileHistory(false)

      expect(await dbh.db.select().from(translateHistoryFileRefTable)).toEqual([
        expect.objectContaining({ role: 'target', fileEntryId: TRANSLATED_ENTRY_ID, sourceId: created.id })
      ])
    })

    it('should reject a second file for the same history role', async () => {
      await seedFileEntries()
      const created = createFileHistory()

      expect(() =>
        dbh.db
          .insert(translateHistoryFileRefTable)
          .values({ sourceId: created.id, fileEntryId: SOURCE_ENTRY_ID, role: 'target' })
          .run()
      ).toThrow(/UNIQUE constraint failed/)
    })

    it.each([false, true])(
      'should cascade its refs away when a history with archived=%s is deleted',
      async (archived) => {
        await seedFileEntries()
        const created = createFileHistory()
        translateHistoryService.update(created.id, { archived })
        const neighbor = await seedHistory({ id: '019606a0-0000-7000-8000-000000000008' })

        translateHistoryService.delete(created.id)

        expect(translateHistoryService.list({ limit: 20 }).items.map((item) => item.id)).toEqual([neighbor.id])
        expect(() => translateHistoryService.getById(created.id)).toThrow()

        // The cascade is what releases the translated PDF to the cleanup anti-join.
        expect(await dbh.db.select().from(translateHistoryFileRefTable)).toHaveLength(0)
        // Deleting refs must not touch the entries themselves — reclaiming them is the
        // cleanup pass's call, and the source entry only ever referenced the user's file.
        expect(await dbh.db.select().from(fileEntryTable)).toHaveLength(2)
      }
    )

    it('should cascade its refs away when history is cleared', async () => {
      await seedFileEntries()
      const archived = createFileHistory()
      translateHistoryService.update(archived.id, { archived: true, star: true })
      createFileHistory(false)
      await seedHistory()

      translateHistoryService.clearAll()

      expect(await dbh.db.select().from(translateHistoryTable)).toHaveLength(0)
      expect(await dbh.db.select().from(translateHistoryFileRefTable)).toHaveLength(0)
      expect(await dbh.db.select().from(fileEntryTable)).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('should update a translate history', async () => {
      const seeded = await seedHistory()

      const dto: UpdateTranslateHistoryDto = { star: true }
      const result = translateHistoryService.update(seeded.id!, dto)
      expect(result.star).toBe(true)

      const [row] = await dbh.db.select().from(translateHistoryTable)
      expect(row.star).toBe(true)
    })

    it('should return existing record on empty update', async () => {
      const seeded = await seedHistory()

      const result = translateHistoryService.update(seeded.id!, {})
      expect(result.id).toBe(seeded.id)
    })

    it('should allow starring and archiving a file history without changing its snapshot', async () => {
      await seedFileEntries()
      const created = createFileHistory()

      const result = translateHistoryService.update(created.id, { star: true, archived: true })

      expect(result.star).toBe(true)
      expect(result.archived).toBe(true)
      expect(result.sourceText).toBe('paper.pdf')
      expect(result.targetText).toBe('paper.zh-CN.pdf')
    })

    it.each([
      ['source text', { sourceText: 'renamed.pdf' }],
      ['target text', { targetText: 'renamed.zh-CN.pdf' }],
      ['source language', { sourceLanguage: null }],
      ['target language', { targetLanguage: null }]
    ] satisfies [string, UpdateTranslateHistoryDto][])(
      'should reject %s changes for file histories',
      async (_field, dto) => {
        await seedFileEntries()
        const created = createFileHistory()

        expect(() => translateHistoryService.update(created.id, dto)).toThrow('only star and archived can be changed')
        expect(() => translateHistoryService.update(created.id, { archived: true, ...dto })).toThrow(
          'only star and archived can be changed'
        )
        expect(translateHistoryService.getById(created.id)).toEqual(created)
      }
    )
  })

  describe('delete', () => {
    it('should delete an existing translate history', async () => {
      const seeded = await seedHistory()

      expect(translateHistoryService.delete(seeded.id!)).toBeUndefined()

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(0)
    })

    it('should throw NotFound for non-existent id', async () => {
      expect(() => translateHistoryService.delete('non-existent')).toThrow()
    })
  })

  describe('clearAll', () => {
    it('should clear all translate histories', async () => {
      await seedHistory()
      await seedHistory({ id: '019606a0-0000-7000-8000-000000000003', sourceText: 'Another' })

      expect(translateHistoryService.clearAll()).toBeUndefined()

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(0)
    })
  })
  describe('archive membership', () => {
    it.each(['text', 'file'] as const)(
      'archives and restores %s without losing identity or references',
      async (kind) => {
        await seedFileEntries()
        const created =
          kind === 'file' ? createFileHistory() : translateHistoryService.getById((await seedHistory()).id!)
        const starred = translateHistoryService.update(created.id, { star: true })
        const refs = dbh.db.select().from(translateHistoryFileRefTable).all()
        const preserved = {
          id: starred.id,
          kind: starred.kind,
          sourceText: starred.sourceText,
          targetText: starred.targetText,
          sourceLanguage: starred.sourceLanguage,
          targetLanguage: starred.targetLanguage,
          star: true,
          createdAt: starred.createdAt
        }

        const archived = translateHistoryService.update(created.id, { archived: true })
        expect(archived).toMatchObject({ ...preserved, archived: true })
        expect(translateHistoryService.list({ limit: 20 }).items).toEqual([])
        expect(translateHistoryService.list({ limit: 20, archived: true }).items).toEqual([archived])
        expect(translateHistoryService.update(created.id, {})).toEqual(archived)
        expect(translateHistoryService.update(created.id, { star: true }).archived).toBe(true)
        if (kind === 'text') {
          expect(translateHistoryService.update(created.id, { sourceText: created.sourceText }).archived).toBe(true)
        }
        expect(translateHistoryService.update(created.id, { archived: true })).toMatchObject(preserved)

        const restored = translateHistoryService.update(created.id, { archived: false })
        expect(restored).toMatchObject({ ...preserved, archived: false })
        expect(translateHistoryService.list({ limit: 20, archived: false }).items).toEqual([restored])
        expect(translateHistoryService.list({ limit: 20, archived: true }).items).toEqual([])
        expect(dbh.db.select().from(translateHistoryFileRefTable).all()).toEqual(refs)
        expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(2)
      }
    )
  })

  describe('filtered keyset pagination', () => {
    const ids = Object.fromEntries(
      'ABCDEFG'.split('').map((label, index) => [label, `019606a0-0000-7000-8000-00000000001${index}`])
    )
    async function seedPages() {
      for (const [index, label] of 'ABCDEFG'.split('').entries()) {
        await seedHistory({
          id: ids[label],
          createdAt: [6000, 5000, 5000, 4000, 3000, 2000, 1000][index],
          archived: 'ADF'.includes(label),
          star: 'ABDE'.includes(label),
          sourceText: 'AB'.includes(label) ? 'needle source' : 'other source',
          targetText: 'DE'.includes(label) ? 'needle target' : 'other target'
        })
      }
    }
    const itemIds = (items: { id: string }[]) => items.map((item) => item.id)

    it('pages each archive mode with independent totals and intersections', async () => {
      await seedPages()
      for (const [archived, first, second, total] of [
        [false, ['B', 'C'], ['E', 'G'], 4],
        [true, ['A', 'D'], ['F'], 3]
      ] as const) {
        const page = translateHistoryService.list({ limit: 2, archived })
        expect(itemIds(page.items)).toEqual(first.map((label) => ids[label]))
        expect(page.total).toBe(total)
        expect(page.nextCursor).toBeDefined()
        const continuation = translateHistoryService.list({ limit: 2, archived, cursor: page.nextCursor })
        expect(itemIds(continuation.items)).toEqual(second.map((label) => ids[label]))
        expect(continuation.total).toBe(total)
        expect(continuation.nextCursor).toBeUndefined()
        const restarted = translateHistoryService.list({ limit: 2, archived, cursor: 'malformed' })
        expect(itemIds(restarted.items)).toEqual(first.map((label) => ids[label]))
      }
      expect(itemIds(translateHistoryService.list({ limit: 2 }).items)).toEqual([ids.B, ids.C])
      for (const [archived, labels] of [
        [false, ['B', 'E']],
        [true, ['A', 'D']]
      ] as const) {
        const result = translateHistoryService.list({ limit: 2, archived, star: true, search: 'needle' })
        expect(itemIds(result.items)).toEqual(labels.map((label) => ids[label]))
        expect(result.total).toBe(2)
        expect(result.nextCursor).toBeUndefined()
      }
      const unstarred = translateHistoryService.list({ limit: 2, star: false })
      expect(itemIds(unstarred.items)).toEqual([ids.C, ids.G])
      expect(unstarred.total).toBe(2)
      expect(unstarred.nextCursor).toBeUndefined()
    })

    it.each(['archive', 'delete'] as const)('continues after the cursor boundary is removed by %s', async (action) => {
      await seedPages()
      const first = translateHistoryService.list({ limit: 2 })
      if (action === 'archive') translateHistoryService.update(ids.C, { archived: true })
      else translateHistoryService.delete(ids.C)

      const next = translateHistoryService.list({ limit: 2, cursor: first.nextCursor })
      expect(itemIds(next.items)).toEqual([ids.E, ids.G])
      expect(next.total).toBe(3)
      expect(next.nextCursor).toBeUndefined()
    })
  })
})

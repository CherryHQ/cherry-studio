import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { CanonicalExternalPath, FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { fileEntryService } = await import('../FileEntryService')

describe('FileEntryService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
  })

  describe('findById / getById', () => {
    it('returns the entry for an existing internal id', async () => {
      const id = '019606a0-0000-7000-8000-000000000001' as FileEntryId
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id,
        origin: 'internal',
        name: 'note',
        ext: 'txt',
        size: 11,
        externalPath: null,
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })

      const entry = await fileEntryService.findById(id)
      expect(entry?.id).toBe(id)
      expect(entry?.origin).toBe('internal')
      if (entry?.origin === 'internal') {
        expect(entry.size).toBe(11)
      }
    })

    it('returns null for missing id', async () => {
      const result = await fileEntryService.findById('019606a0-0000-7000-8000-9999ffffffff' as FileEntryId)
      expect(result).toBeNull()
    })

    it('getById throws a typed DataApiError(NOT_FOUND) for missing id', async () => {
      // Regression: prior to the DataApiErrorFactory.notFound fix, this path
      // threw a plain Error which the IPC adapter routed through internal() →
      // HTTP 500. Renderer-side `error.code === ErrorCode.NOT_FOUND` branches
      // never matched. Pin both the class and the typed code so a future
      // "throw a generic error" regression is caught at the service boundary.
      const missing = '019606a0-0000-7000-8000-9999fffffffe' as FileEntryId
      const promise = fileEntryService.getById(missing)
      await expect(promise).rejects.toBeInstanceOf(DataApiError)
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'FileEntry', id: missing }
      })
    })

    it('returns trashed internal entries (filtering is caller responsibility)', async () => {
      const id = '019606a0-0000-7000-8000-000000000002' as FileEntryId
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id,
        origin: 'internal',
        name: 'old',
        ext: 'md',
        size: 0,
        externalPath: null,
        trashedAt: now,
        createdAt: now,
        updatedAt: now
      })

      const entry = await fileEntryService.findById(id)
      if (entry?.origin === 'internal') {
        expect(entry.trashedAt).toBe(now)
      } else {
        throw new Error('expected internal entry')
      }
    })
  })

  describe('findByExternalPath', () => {
    it('returns the external entry by canonical path', async () => {
      const id = '019606a0-0000-7000-8000-000000000010' as FileEntryId
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id,
        origin: 'external',
        name: 'doc',
        ext: 'pdf',
        size: null,
        externalPath: '/Users/me/doc.pdf',
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })

      const entry = await fileEntryService.findByExternalPath('/Users/me/doc.pdf' as CanonicalExternalPath)
      expect(entry?.id).toBe(id)
      expect(entry?.origin).toBe('external')
    })

    it('returns null when no row matches', async () => {
      const result = await fileEntryService.findByExternalPath('/Users/me/nonexistent.pdf' as CanonicalExternalPath)
      expect(result).toBeNull()
    })

    it('is case-sensitive (byte-exact match)', async () => {
      const id = '019606a0-0000-7000-8000-000000000011' as FileEntryId
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id,
        origin: 'external',
        name: 'a',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/a.txt',
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })

      const result = await fileEntryService.findByExternalPath('/Users/me/A.TXT' as CanonicalExternalPath)
      expect(result).toBeNull()
    })
  })

  describe('findCaseInsensitivePeers', () => {
    it('finds an existing peer for a case-different canonical lookup (single peer — DB enforces uniqueness)', async () => {
      // The functional unique index `fe_external_path_lower_unique_idx` on
      // `lower(externalPath)` makes "two rows that case-collide" an
      // unrepresentable DB state, so this method returns at most one peer
      // in practice. Method shape stays array-returning for forward-compat
      // and to keep the call site stable when callers iterate.
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id: '019606a0-0000-7000-8000-000000000020' as FileEntryId,
        origin: 'external',
        name: 'a',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/A.TXT',
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })

      const peers = await fileEntryService.findCaseInsensitivePeers('/Users/me/a.txt' as CanonicalExternalPath)
      expect(peers).toHaveLength(1)
      expect(peers[0]?.id).toBe('019606a0-0000-7000-8000-000000000020')
    })

    it('returns empty array when no rows match', async () => {
      const peers = await fileEntryService.findCaseInsensitivePeers('/zzz/none.txt' as CanonicalExternalPath)
      expect(peers).toEqual([])
    })

    it('rejects a second insert that case-collides with an existing row (DB unique constraint)', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id: '019606a0-0000-7000-8000-000000000022' as FileEntryId,
        origin: 'external',
        name: 'a',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/A.TXT',
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })
      // libsql / drizzle wraps the SQLite SQLITE_CONSTRAINT_UNIQUE error in a
      // `Failed query: ...` envelope with the original sqlite error message
      // moved to `.cause`. Match on the envelope (stable across drizzle
      // versions) plus the underlying cause's UNIQUE marker.
      let caught: unknown
      try {
        await dbh.db.insert(fileEntryTable).values({
          id: '019606a0-0000-7000-8000-000000000023' as FileEntryId,
          origin: 'external',
          name: 'a',
          ext: 'txt',
          size: null,
          externalPath: '/Users/me/a.txt',
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(Error)
      const causeMsg = (caught as Error & { cause?: { message?: string } }).cause?.message ?? ''
      const envelope = (caught as Error).message
      expect(causeMsg + envelope).toMatch(/UNIQUE|fe_external_path_lower_unique_idx/i)
    })
  })

  describe('findMany', () => {
    it('returns all active entries when no query is given', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000030' as FileEntryId,
          origin: 'internal',
          name: 'a',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000031' as FileEntryId,
          origin: 'internal',
          name: 'b',
          ext: 'md',
          size: 2,
          externalPath: null,
          trashedAt: now,
          createdAt: now,
          updatedAt: now
        }
      ])

      const entries = await fileEntryService.findMany()
      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('a')
    })

    it('filters by origin', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000040' as FileEntryId,
          origin: 'internal',
          name: 'i',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000041' as FileEntryId,
          origin: 'external',
          name: 'e',
          ext: 'pdf',
          size: null,
          externalPath: '/foo/e.pdf',
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        }
      ])

      const externals = await fileEntryService.findMany({ origin: 'external' })
      expect(externals).toHaveLength(1)
      expect(externals[0].origin).toBe('external')
    })

    it('returns trashed entries when inTrash=true', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000050' as FileEntryId,
          origin: 'internal',
          name: 'live',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000051' as FileEntryId,
          origin: 'internal',
          name: 'dead',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: now,
          createdAt: now,
          updatedAt: now
        }
      ])

      const trashed = await fileEntryService.findMany({ inTrash: true })
      expect(trashed).toHaveLength(1)
      expect(trashed[0].name).toBe('dead')
    })

    it('respects limit + offset', async () => {
      const now = Date.now()
      const rows = Array.from({ length: 5 }, (_, i) => ({
        id: `019606a0-0000-7000-8000-00000000006${i}`,
        origin: 'internal' as const,
        name: `n${i}`,
        ext: 'txt',
        size: i,
        externalPath: null,
        trashedAt: null,
        createdAt: now + i,
        updatedAt: now + i
      }))
      await dbh.db.insert(fileEntryTable).values(rows)

      const page = await fileEntryService.findMany({ limit: 2, offset: 1 })
      expect(page).toHaveLength(2)
    })
  })

  describe('listPaged', () => {
    async function seed5(): Promise<void> {
      const now = Date.now()
      const rows = Array.from({ length: 5 }, (_, i) => ({
        id: `019606a0-0000-7000-8000-0000000000b${i}`,
        origin: 'internal' as const,
        name: `name${i}`,
        ext: 'txt',
        size: i + 1,
        externalPath: null,
        trashedAt: null,
        createdAt: now + i,
        updatedAt: now + i
      }))
      await dbh.db.insert(fileEntryTable).values(rows)
    }

    it('returns { items, total, page } with active-only filtering by default', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-0000000000c0' as FileEntryId,
          origin: 'internal',
          name: 'a',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-0000000000c1' as FileEntryId,
          origin: 'internal',
          name: 'b',
          ext: 'txt',
          size: 2,
          externalPath: null,
          trashedAt: now,
          createdAt: now,
          updatedAt: now
        }
      ])

      const result = await fileEntryService.listPaged()
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('a')
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
    })

    it('paginates with page+limit and reports the true total across pages', async () => {
      await seed5()

      const page1 = await fileEntryService.listPaged({ page: 1, limit: 2 })
      const page2 = await fileEntryService.listPaged({ page: 2, limit: 2 })
      const page3 = await fileEntryService.listPaged({ page: 3, limit: 2 })

      expect(page1.items).toHaveLength(2)
      expect(page1.total).toBe(5)
      expect(page2.items).toHaveLength(2)
      expect(page2.total).toBe(5)
      expect(page3.items).toHaveLength(1)
      expect(page3.total).toBe(5)
      expect(page3.page).toBe(3)
    })

    it('sorts ascending by createdAt by default; reverses with sortOrder=desc', async () => {
      await seed5()

      const asc = await fileEntryService.listPaged({})
      expect(asc.items.map((e) => e.name)).toEqual(['name0', 'name1', 'name2', 'name3', 'name4'])

      const desc = await fileEntryService.listPaged({ sortOrder: 'desc' })
      expect(desc.items.map((e) => e.name)).toEqual(['name4', 'name3', 'name2', 'name1', 'name0'])
    })

    it('sortBy=name orders by name lexicographically', async () => {
      const now = Date.now()
      // Out-of-order createdAt to ensure sortBy=name is what is being verified
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-0000000000d0' as FileEntryId,
          origin: 'internal',
          name: 'charlie',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        },
        {
          id: '019606a0-0000-7000-8000-0000000000d1' as FileEntryId,
          origin: 'internal',
          name: 'alpha',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-0000000000d2' as FileEntryId,
          origin: 'internal',
          name: 'bravo',
          ext: 'txt',
          size: 1,
          externalPath: null,
          trashedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        }
      ])

      const result = await fileEntryService.listPaged({ sortBy: 'name' })
      expect(result.items.map((e) => e.name)).toEqual(['alpha', 'bravo', 'charlie'])
    })

    it('returns { items: [], total: 0 } on an empty table', async () => {
      const result = await fileEntryService.listPaged()
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.page).toBe(1)
    })

    /**
     * Tie-breaker coverage: without a secondary `ORDER BY id`, SQLite's row
     * order for equal sort values is unspecified, so `limit/offset`
     * pagination over ties can surface the same row twice across pages or
     * drop a row entirely. These tests pin the deterministic-across-pages
     * contract — page1 ∪ page2 must equal the full row set, no duplicates,
     * no misses — for both sort directions.
     */
    describe('stable pagination over tied sort values', () => {
      async function seedSameCreatedAt(): Promise<string[]> {
        const sharedTs = 1700000000000
        const ids = [
          '019606a0-0000-7000-8000-0000000000e0',
          '019606a0-0000-7000-8000-0000000000e1',
          '019606a0-0000-7000-8000-0000000000e2',
          '019606a0-0000-7000-8000-0000000000e3'
        ]
        await dbh.db.insert(fileEntryTable).values(
          ids.map((id, i) => ({
            id,
            origin: 'internal' as const,
            name: `tie${i}`,
            ext: 'txt',
            size: 1,
            externalPath: null,
            trashedAt: null,
            createdAt: sharedTs,
            updatedAt: sharedTs
          }))
        )
        return ids
      }

      it('asc: pages over rows with identical createdAt have no overlap and miss nothing', async () => {
        const ids = await seedSameCreatedAt()
        const page1 = await fileEntryService.listPaged({ page: 1, limit: 2 })
        const page2 = await fileEntryService.listPaged({ page: 2, limit: 2 })

        const seen = [...page1.items, ...page2.items].map((e) => e.id)
        expect(seen).toHaveLength(4)
        expect(new Set(seen).size).toBe(4)
        // Spread before sort — Array.sort is in-place; without the copy the
        // strict-order assertion below would see the sorted array, not the
        // original page-merge result.
        expect([...seen].sort()).toEqual([...ids].sort())
        // With sortOrder default (asc), the id tie-breaker is asc → ascending id order.
        expect(seen).toEqual(ids)
      })

      it('desc: pages over rows with identical name have no overlap and miss nothing', async () => {
        const sharedTs = 1700000000000
        const ids = [
          '019606a0-0000-7000-8000-0000000000f0',
          '019606a0-0000-7000-8000-0000000000f1',
          '019606a0-0000-7000-8000-0000000000f2',
          '019606a0-0000-7000-8000-0000000000f3'
        ]
        await dbh.db.insert(fileEntryTable).values(
          ids.map((id) => ({
            id,
            origin: 'internal' as const,
            name: 'duplicate',
            ext: 'txt',
            size: 1,
            externalPath: null,
            trashedAt: null,
            createdAt: sharedTs,
            updatedAt: sharedTs
          }))
        )

        const page1 = await fileEntryService.listPaged({ sortBy: 'name', sortOrder: 'desc', page: 1, limit: 2 })
        const page2 = await fileEntryService.listPaged({ sortBy: 'name', sortOrder: 'desc', page: 2, limit: 2 })

        const seen = [...page1.items, ...page2.items].map((e) => e.id)
        expect(seen).toHaveLength(4)
        expect(new Set(seen).size).toBe(4)
        // Spread before sort — Array.sort is in-place; without the copy the
        // strict-order assertion below would see the sorted array, not the
        // original page-merge result.
        expect([...seen].sort()).toEqual([...ids].sort())
        // With sortOrder=desc, the id tie-breaker is desc → reversed id order.
        expect(seen).toEqual([...ids].reverse())
      })
    })
  })

  describe('create', () => {
    it('inserts an internal row and returns a parsed FileEntry', async () => {
      const id = '019606a0-0000-7000-8000-000000000a01' as FileEntryId
      const entry = await fileEntryService.create({
        id,
        origin: 'internal',
        name: 'note',
        ext: 'txt',
        size: 11,
        externalPath: null
      })
      expect(entry.id).toBe(id)
      expect(entry.origin).toBe('internal')
      if (entry.origin === 'internal') {
        expect(entry.size).toBe(11)
      }
      expect(entry.createdAt).toBeGreaterThan(0)
      expect(entry.updatedAt).toBeGreaterThan(0)
    })

    it('inserts an external row with size=null in DB; size absent on BO projection', async () => {
      const id = '019606a0-0000-7000-8000-000000000a02' as FileEntryId
      const entry = await fileEntryService.create({
        id,
        origin: 'external',
        name: 'doc',
        ext: 'pdf',
        size: null,
        externalPath: '/Users/me/doc.pdf'
      })
      // BO shape: external variant has no `size` field at all (live values
      // come from File IPC `getMetadata`); the DB still stores `size: null`.
      expect(entry.origin).toBe('external')
      expect(entry).not.toHaveProperty('size')
      if (entry.origin === 'external') {
        expect(entry.externalPath).toBe('/Users/me/doc.pdf')
      }
    })

    it('throws when external row has non-null size (CHECK fe_size_internal_only)', async () => {
      const id = '019606a0-0000-7000-8000-000000000a03' as FileEntryId
      await expect(
        fileEntryService.create({
          id,
          origin: 'external',
          name: 'doc',
          ext: 'pdf',
          size: 100,
          externalPath: '/Users/me/doc2.pdf'
        })
      ).rejects.toThrow()
    })

    it('throws when internal row has externalPath (CHECK fe_origin_consistency)', async () => {
      const id = '019606a0-0000-7000-8000-000000000a04' as FileEntryId
      await expect(
        fileEntryService.create({
          id,
          origin: 'internal',
          name: 'note',
          ext: 'txt',
          size: 1,
          externalPath: '/some/path' as string
        })
      ).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('updates name and refreshes updatedAt', async () => {
      const id = '019606a0-0000-7000-8000-000000000b01' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'old', ext: 'txt', size: 1, externalPath: null })
      const original = await fileEntryService.getById(id)
      await new Promise((r) => setTimeout(r, 5))
      const updated = await fileEntryService.update(id, { name: 'new' })
      expect(updated.name).toBe('new')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
    })

    it('throws a typed DataApiError(NOT_FOUND) when entry does not exist', async () => {
      // Mirror of the getById typed-contract pin (line 51). A regression that
      // swapped to a generic Error with a similar message would slip past a
      // `/not found/i` regex check but break renderer-side `error.code ===
      // ErrorCode.NOT_FOUND` branches.
      const missing = '019606a0-0000-7000-8000-000000000bff' as FileEntryId
      const promise = fileEntryService.update(missing, { name: 'x' })
      await expect(promise).rejects.toBeInstanceOf(DataApiError)
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'FileEntry', id: missing }
      })
    })

    it('updates trashedAt for soft delete', async () => {
      const id = '019606a0-0000-7000-8000-000000000b02' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'tmp', ext: 'txt', size: 1, externalPath: null })
      const trashedAt = Date.now()
      const updated = await fileEntryService.update(id, { trashedAt })
      if (updated.origin !== 'internal') throw new Error('expected internal entry')
      expect(updated.trashedAt).toBe(trashedAt)
    })

    it('throws when setting trashedAt on an external row (CHECK fe_external_no_trash)', async () => {
      const id = '019606a0-0000-7000-8000-000000000b03' as FileEntryId
      await fileEntryService.create({
        id,
        origin: 'external',
        name: 'ext',
        ext: 'txt',
        size: null,
        externalPath: '/x/y.txt'
      })
      await expect(fileEntryService.update(id, { trashedAt: Date.now() })).rejects.toThrow()
    })

    it('rejects unsafe name BEFORE the SQL UPDATE commits', async () => {
      // Regression: without the pre-SQL SafeNameSchema.parse, an unsafe
      // name (null byte, path separators, `..`, > 255 chars) hits SQLite
      // unchanged and only fails at the `rowToFileEntry` parse — leaving
      // the row permanently un-parseable. Pin the contract by reading the
      // row back with a raw SELECT after the rejection and asserting the
      // `name` column is unchanged.
      const id = '019606a0-0000-7000-8000-000000000b04' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'safe', ext: 'txt', size: 1, externalPath: null })

      await expect(fileEntryService.update(id, { name: 'has\0null' })).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id))
      expect(raw?.name).toBe('safe')
    })
  })

  describe('listAllIds', () => {
    // listAllIds backs the Phase 1b.4 startup disk scan, which decides which
    // on-disk UUID files are orphaned (no DB row, regardless of trashed
    // state). The implementation is one query — the regressions worth
    // catching are misclassifying trashed rows as deleted (trashedAt filter
    // creeping in) or returning an array shape.

    it('returns an empty Set on an empty table', async () => {
      const ids = await fileEntryService.listAllIds()
      expect(ids).toBeInstanceOf(Set)
      expect(ids.size).toBe(0)
    })

    it('includes both active and trashed rows', async () => {
      const active = '019606a0-0000-7000-8000-000000000e01' as FileEntryId
      const trashed = '019606a0-0000-7000-8000-000000000e02' as FileEntryId
      await fileEntryService.create({
        id: active,
        origin: 'internal',
        name: 'a',
        ext: 'txt',
        size: 1,
        externalPath: null
      })
      await fileEntryService.create({
        id: trashed,
        origin: 'internal',
        name: 't',
        ext: 'txt',
        size: 1,
        externalPath: null,
        trashedAt: Date.now()
      })

      const ids = await fileEntryService.listAllIds()
      expect(ids).toBeInstanceOf(Set)
      expect(ids.has(active)).toBe(true)
      expect(ids.has(trashed)).toBe(true)
      expect(ids.size).toBe(2)
    })
  })

  describe('setExternalPathAndName', () => {
    // setExternalPathAndName is the only sanctioned mutation site for
    // FileEntry.externalPath (per the interface JSDoc) and the atomic core of
    // the external rename flow. Pin the three legs that callers actually
    // observe so a regression here is caught at the service surface, not
    // miles downstream in the rename orchestrator.

    it('returns the refreshed row with new path and name', async () => {
      const id = '019606a0-0000-7000-8000-000000000d01' as FileEntryId
      await fileEntryService.create({
        id,
        origin: 'external',
        name: 'old-doc',
        ext: 'pdf',
        size: null,
        externalPath: '/Users/me/old-doc.pdf'
      })
      const original = await fileEntryService.getById(id)
      await new Promise((r) => setTimeout(r, 5))

      const updated = await fileEntryService.setExternalPathAndName(
        id,
        '/Users/me/new-doc.pdf' as CanonicalExternalPath,
        'new-doc'
      )

      expect(updated.id).toBe(id)
      if (updated.origin !== 'external') throw new Error('expected external entry')
      expect(updated.externalPath).toBe('/Users/me/new-doc.pdf')
      expect(updated.name).toBe('new-doc')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
      // Row is committed (not just returned from the in-memory diff)
      const refetched = await fileEntryService.getById(id)
      if (refetched.origin !== 'external') throw new Error('expected external entry')
      expect(refetched.externalPath).toBe('/Users/me/new-doc.pdf')
      expect(refetched.name).toBe('new-doc')
    })

    it('throws a typed DataApiError(NOT_FOUND) when the entry does not exist', async () => {
      // Mirror of the getById typed-contract pin (line 51).
      const missing = '019606a0-0000-7000-8000-000000000dff' as FileEntryId
      const promise = fileEntryService.setExternalPathAndName(
        missing,
        '/Users/me/ghost.pdf' as CanonicalExternalPath,
        'ghost'
      )
      await expect(promise).rejects.toBeInstanceOf(DataApiError)
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'FileEntry', id: missing }
      })
    })

    it('rejects unsafe name BEFORE the SQL UPDATE commits', async () => {
      // Same regression class as the `update` typed-name guard: an unsafe
      // name must not reach SQLite, otherwise the row gets stuck past
      // `rowToFileEntry` parse. Raw SELECT proves the row stayed unchanged.
      const id = '019606a0-0000-7000-8000-000000000d20' as FileEntryId
      await fileEntryService.create({
        id,
        origin: 'external',
        name: 'safe',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/safe.txt'
      })

      await expect(
        fileEntryService.setExternalPathAndName(id, '/Users/me/legit.txt' as CanonicalExternalPath, '../evil')
      ).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id))
      expect(raw?.name).toBe('safe')
      expect(raw?.externalPath).toBe('/Users/me/safe.txt')
    })

    it('rejects unsafe externalPath BEFORE the SQL UPDATE commits', async () => {
      // The `CanonicalExternalPath` brand is TS-only and offers no runtime
      // guarantee. The service-side `AbsolutePathSchema.parse(externalPath)`
      // catches null bytes / non-absolute paths regardless of whether the
      // caller went through `canonicalizeExternalPath` or `as`-cast.
      const id = '019606a0-0000-7000-8000-000000000d21' as FileEntryId
      await fileEntryService.create({
        id,
        origin: 'external',
        name: 'safe',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/safe.txt'
      })

      await expect(
        fileEntryService.setExternalPathAndName(id, '/Users/me/null\0byte.txt' as CanonicalExternalPath, 'fine')
      ).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id))
      expect(raw?.name).toBe('safe')
      expect(raw?.externalPath).toBe('/Users/me/safe.txt')
    })

    it('throws on fe_external_path_unique_idx conflict (race against a concurrent rename to the same path)', async () => {
      // Two external entries racing to claim the same canonical path: the
      // unique index rejects the second UPDATE with a SQLite constraint
      // failure. Callers that catch only "not found"-shaped errors would
      // otherwise see this as an unhandled rejection.
      const a = '019606a0-0000-7000-8000-000000000d10' as FileEntryId
      const b = '019606a0-0000-7000-8000-000000000d11' as FileEntryId
      await fileEntryService.create({
        id: a,
        origin: 'external',
        name: 'a',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/a.txt'
      })
      await fileEntryService.create({
        id: b,
        origin: 'external',
        name: 'b',
        ext: 'txt',
        size: null,
        externalPath: '/Users/me/b.txt'
      })

      // Drizzle wraps the SQLite constraint error in its own "Failed query: …"
      // shape, so we don't pin a specific keyword. The contract DeJeune flagged
      // is the negative one: this is NOT a "not found"-shaped error, so callers
      // catching only that branch will correctly surface this case as
      // unexpected and bubble it up.
      const err = await fileEntryService
        .setExternalPathAndName(b, '/Users/me/a.txt' as CanonicalExternalPath, 'a')
        .then(
          () => null,
          (e: Error) => e
        )
      expect(err).toBeInstanceOf(Error)
      expect(err?.message).not.toMatch(/not found/i)
      // The conflicting entry is unchanged after the failed mutation
      const refetched = await fileEntryService.getById(b)
      if (refetched.origin !== 'external') throw new Error('expected external entry')
      expect(refetched.externalPath).toBe('/Users/me/b.txt')
    })
  })

  describe('delete', () => {
    it('removes an existing row', async () => {
      const id = '019606a0-0000-7000-8000-000000000c01' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'd', ext: 'txt', size: 1, externalPath: null })
      await fileEntryService.delete(id)
      expect(await fileEntryService.findById(id)).toBeNull()
    })

    it('is idempotent on missing id', async () => {
      await expect(
        fileEntryService.delete('019606a0-0000-7000-8000-000000000cff' as FileEntryId)
      ).resolves.toBeUndefined()
    })
  })

  describe('findUnreferenced', () => {
    async function seedRef(fileEntryId: FileEntryId): Promise<void> {
      const now = Date.now()
      await dbh.db.insert(fileRefTable).values({
        id: '11111111-1111-4111-8111-' + fileEntryId.slice(-12),
        fileEntryId,
        sourceType: 'temp_session',
        sourceId: 'sess-1',
        role: 'pending',
        createdAt: now,
        updatedAt: now
      })
    }

    it('returns only entries with zero file_refs', async () => {
      const referenced = '019606a0-0000-7000-8000-000000000d01' as FileEntryId
      const orphan = '019606a0-0000-7000-8000-000000000d02' as FileEntryId
      await fileEntryService.create({
        id: referenced,
        origin: 'internal',
        name: 'r',
        ext: 'txt',
        size: 1,
        externalPath: null
      })
      await fileEntryService.create({
        id: orphan,
        origin: 'internal',
        name: 'o',
        ext: 'txt',
        size: 1,
        externalPath: null
      })
      await seedRef(referenced)

      const result = await fileEntryService.findUnreferenced()
      const ids = result.map((e) => e.id)
      expect(ids).toEqual([orphan])
    })

    it('honours the optional origin filter', async () => {
      const internalOrphan = '019606a0-0000-7000-8000-000000000d11' as FileEntryId
      const externalOrphan = '019606a0-0000-7000-8000-000000000d12' as FileEntryId
      await fileEntryService.create({
        id: internalOrphan,
        origin: 'internal',
        name: 'i',
        ext: 'txt',
        size: 1,
        externalPath: null
      })
      await fileEntryService.create({
        id: externalOrphan,
        origin: 'external',
        name: 'e',
        ext: 'txt',
        size: null,
        externalPath: '/abs/orphan.txt' as CanonicalExternalPath
      })

      const externalsOnly = await fileEntryService.findUnreferenced({ origin: 'external' })
      expect(externalsOnly.map((e) => e.id)).toEqual([externalOrphan])

      const internalsOnly = await fileEntryService.findUnreferenced({ origin: 'internal' })
      expect(internalsOnly.map((e) => e.id)).toEqual([internalOrphan])
    })

    it('excludes trashed entries', async () => {
      const id = '019606a0-0000-7000-8000-000000000d21' as FileEntryId
      await fileEntryService.create({
        id,
        origin: 'internal',
        name: 't',
        ext: 'txt',
        size: 1,
        externalPath: null,
        trashedAt: Date.now()
      })

      const result = await fileEntryService.findUnreferenced()
      expect(result.find((e) => e.id === id)).toBeUndefined()
    })
  })
})

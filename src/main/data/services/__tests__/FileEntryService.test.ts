import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { CanonicalExternalPath, FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
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
      expect(entry?.size).toBe(11)
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
      expect(entry?.trashedAt).toBe(now)
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
    it('returns rows with case-insensitive matches including the byte-exact one', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000020' as FileEntryId,
          origin: 'external',
          name: 'a',
          ext: 'txt',
          size: null,
          externalPath: '/Users/me/A.TXT',
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000021' as FileEntryId,
          origin: 'external',
          name: 'a',
          ext: 'txt',
          size: null,
          externalPath: '/Users/me/a.txt',
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        }
      ])

      const peers = await fileEntryService.findCaseInsensitivePeers('/Users/me/a.txt' as CanonicalExternalPath)
      expect(peers).toHaveLength(2)
    })

    it('returns empty array when no rows match', async () => {
      const peers = await fileEntryService.findCaseInsensitivePeers('/zzz/none.txt' as CanonicalExternalPath)
      expect(peers).toEqual([])
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
      expect(entry.size).toBe(11)
      expect(entry.createdAt).toBeGreaterThan(0)
      expect(entry.updatedAt).toBeGreaterThan(0)
    })

    it('inserts an external row with size=null', async () => {
      const id = '019606a0-0000-7000-8000-000000000a02' as FileEntryId
      const entry = await fileEntryService.create({
        id,
        origin: 'external',
        name: 'doc',
        ext: 'pdf',
        size: null,
        externalPath: '/Users/me/doc.pdf'
      })
      expect(entry.origin).toBe('external')
      expect(entry.size).toBeNull()
      expect(entry.externalPath).toBe('/Users/me/doc.pdf')
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

    it('throws when entry does not exist', async () => {
      await expect(
        fileEntryService.update('019606a0-0000-7000-8000-000000000bff' as FileEntryId, { name: 'x' })
      ).rejects.toThrow(/not found/i)
    })

    it('updates trashedAt for soft delete', async () => {
      const id = '019606a0-0000-7000-8000-000000000b02' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'tmp', ext: 'txt', size: 1, externalPath: null })
      const trashedAt = Date.now()
      const updated = await fileEntryService.update(id, { trashedAt })
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
      expect(updated.externalPath).toBe('/Users/me/new-doc.pdf')
      expect(updated.name).toBe('new-doc')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
      // Row is committed (not just returned from the in-memory diff)
      const refetched = await fileEntryService.getById(id)
      expect(refetched.externalPath).toBe('/Users/me/new-doc.pdf')
      expect(refetched.name).toBe('new-doc')
    })

    it('throws when the entry does not exist', async () => {
      await expect(
        fileEntryService.setExternalPathAndName(
          '019606a0-0000-7000-8000-000000000dff' as FileEntryId,
          '/Users/me/ghost.pdf' as CanonicalExternalPath,
          'ghost'
        )
      ).rejects.toThrow(/not found/i)
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

import { fileEntryTable } from '@data/db/schemas/file'
import { paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { paintingTable } from '@data/db/schemas/painting'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { CanonicalExternalPath, FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport, MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `@logger` is mocked globally by tests/main.setup.ts with the unified
// MockMainLoggerService singleton — assert on `mockMainLoggerService.warn`.

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
        deletedAt: null,
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
        deletedAt: now,
        createdAt: now,
        updatedAt: now
      })

      const entry = await fileEntryService.findById(id)
      if (entry?.origin === 'internal') {
        expect(entry.deletedAt).toBe(now)
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
        deletedAt: null,
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
        deletedAt: null,
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
        deletedAt: null,
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
        deletedAt: null,
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
          deletedAt: null,
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
          deletedAt: null,
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
          deletedAt: now,
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
          deletedAt: null,
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
          deletedAt: null,
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
          deletedAt: null,
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
          deletedAt: now,
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
        deletedAt: null,
        createdAt: now + i,
        updatedAt: now + i
      }))
      await dbh.db.insert(fileEntryTable).values(rows)

      const page = await fileEntryService.findMany({ limit: 2, offset: 1 })
      expect(page).toHaveLength(2)
    })
  })

  describe('listCursor', () => {
    async function seed5(): Promise<void> {
      const now = Date.now()
      const rows = Array.from({ length: 5 }, (_, i) => ({
        id: `019606a0-0000-7000-8000-0000000000b${i}`,
        origin: 'internal' as const,
        name: `name${i}`,
        ext: 'txt',
        size: i + 1,
        externalPath: null,
        deletedAt: null,
        createdAt: now + i,
        updatedAt: now + i
      }))
      await dbh.db.insert(fileEntryTable).values(rows)
    }

    it('returns { items, total, nextCursor } with active-only filtering by default', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-0000000000c0' as FileEntryId,
          origin: 'internal',
          name: 'a',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
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
          deletedAt: now,
          createdAt: now,
          updatedAt: now
        }
      ])

      const result = await fileEntryService.listCursor()
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('a')
      expect(result.total).toBe(1)
      expect(result.nextCursor).toBeUndefined()
    })

    it('paginates with cursor+limit and reports the true total across pages', async () => {
      await seed5()

      const page1 = await fileEntryService.listCursor({ limit: 2 })
      const page2 = await fileEntryService.listCursor({ cursor: page1.nextCursor, limit: 2 })
      const page3 = await fileEntryService.listCursor({ cursor: page2.nextCursor, limit: 2 })

      expect(page1.items.map((e) => e.name)).toEqual(['name0', 'name1'])
      expect(page1.total).toBe(5)
      expect(page1.nextCursor).toBeDefined()
      expect(page2.items.map((e) => e.name)).toEqual(['name2', 'name3'])
      expect(page2.total).toBe(5)
      expect(page2.nextCursor).toBeDefined()
      expect(page3.items.map((e) => e.name)).toEqual(['name4'])
      expect(page3.total).toBe(5)
      expect(page3.nextCursor).toBeUndefined()
    })

    it('sorts ascending by createdAt by default; reverses with sortOrder=desc', async () => {
      await seed5()

      const asc = await fileEntryService.listCursor({})
      expect(asc.items.map((e) => e.name)).toEqual(['name0', 'name1', 'name2', 'name3', 'name4'])

      const desc = await fileEntryService.listCursor({ sortOrder: 'desc' })
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
          deletedAt: null,
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
          deletedAt: null,
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
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        }
      ])

      const result = await fileEntryService.listCursor({ sortBy: 'name' })
      expect(result.items.map((e) => e.name)).toEqual(['alpha', 'bravo', 'charlie'])
    })

    it('sortBy=name cursor pagination handles colon-containing boundary names', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000100' as FileEntryId,
          origin: 'internal',
          name: 'alpha',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000101' as FileEntryId,
          origin: 'internal',
          name: 'meeting:notes',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        },
        {
          id: '019606a0-0000-7000-8000-000000000102' as FileEntryId,
          origin: 'internal',
          name: 'zulu',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        }
      ])

      const page1 = await fileEntryService.listCursor({ sortBy: 'name', sortOrder: 'asc', limit: 2 })
      const page2 = await fileEntryService.listCursor({
        sortBy: 'name',
        sortOrder: 'asc',
        cursor: page1.nextCursor,
        limit: 2
      })

      expect(page1.items.map((e) => e.name)).toEqual(['alpha', 'meeting:notes'])
      expect(page2.items.map((e) => e.name)).toEqual(['zulu'])
      const seen = [...page1.items, ...page2.items].map((e) => e.id)
      expect(new Set(seen).size).toBe(3)
    })

    it('sortBy=size treats null sizes as the lowest sentinel value', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-0000000000d3' as FileEntryId,
          origin: 'internal',
          name: 'zero',
          ext: 'txt',
          size: 0,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-0000000000d4' as FileEntryId,
          origin: 'external',
          name: 'external-null',
          ext: 'txt',
          size: null,
          externalPath: '/tmp/external-null.txt',
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        },
        {
          id: '019606a0-0000-7000-8000-0000000000d5' as FileEntryId,
          origin: 'internal',
          name: 'ten',
          ext: 'txt',
          size: 10,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        }
      ])

      const asc = await fileEntryService.listCursor({ sortBy: 'size', sortOrder: 'asc' })
      expect(asc.items.map((e) => e.name)).toEqual(['external-null', 'zero', 'ten'])

      const desc = await fileEntryService.listCursor({ sortBy: 'size', sortOrder: 'desc' })
      expect(desc.items.map((e) => e.name)).toEqual(['ten', 'zero', 'external-null'])
    })

    it('sortBy=ext treats null extensions as the lowest sentinel value', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-0000000000d6' as FileEntryId,
          origin: 'internal',
          name: 'text',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-0000000000d7' as FileEntryId,
          origin: 'internal',
          name: 'no-ext',
          ext: null,
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        },
        {
          id: '019606a0-0000-7000-8000-0000000000d8' as FileEntryId,
          origin: 'internal',
          name: 'markdown',
          ext: 'md',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        }
      ])

      const asc = await fileEntryService.listCursor({ sortBy: 'ext', sortOrder: 'asc' })
      expect(asc.items.map((e) => e.name)).toEqual(['no-ext', 'markdown', 'text'])

      const desc = await fileEntryService.listCursor({ sortBy: 'ext', sortOrder: 'desc' })
      expect(desc.items.map((e) => e.name)).toEqual(['text', 'markdown', 'no-ext'])
    })

    it('sortBy=size cursor pagination handles null-size rows at the page boundary', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000120' as FileEntryId,
          origin: 'external',
          name: 'null-size-a',
          ext: 'txt',
          size: null,
          externalPath: '/tmp/null-size-a.txt',
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000121' as FileEntryId,
          origin: 'external',
          name: 'null-size-b',
          ext: 'txt',
          size: null,
          externalPath: '/tmp/null-size-b.txt',
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        },
        {
          id: '019606a0-0000-7000-8000-000000000122' as FileEntryId,
          origin: 'internal',
          name: 'zero',
          ext: 'txt',
          size: 0,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        }
      ])

      const page1 = await fileEntryService.listCursor({ sortBy: 'size', sortOrder: 'asc', limit: 1 })
      const page2 = await fileEntryService.listCursor({
        sortBy: 'size',
        sortOrder: 'asc',
        cursor: page1.nextCursor,
        limit: 1
      })
      const page3 = await fileEntryService.listCursor({
        sortBy: 'size',
        sortOrder: 'asc',
        cursor: page2.nextCursor,
        limit: 1
      })

      expect([page1.items[0]?.name, page2.items[0]?.name, page3.items[0]?.name]).toEqual([
        'null-size-a',
        'null-size-b',
        'zero'
      ])
      expect(page3.nextCursor).toBeUndefined()
    })

    it('sortBy=ext cursor pagination handles null-ext rows at the page boundary', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000110' as FileEntryId,
          origin: 'internal',
          name: 'no-ext-a',
          ext: null,
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000111' as FileEntryId,
          origin: 'internal',
          name: 'no-ext-b',
          ext: null,
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        },
        {
          id: '019606a0-0000-7000-8000-000000000112' as FileEntryId,
          origin: 'internal',
          name: 'text',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        }
      ])

      const page1 = await fileEntryService.listCursor({ sortBy: 'ext', sortOrder: 'asc', limit: 1 })
      const page2 = await fileEntryService.listCursor({
        sortBy: 'ext',
        sortOrder: 'asc',
        cursor: page1.nextCursor,
        limit: 1
      })
      const page3 = await fileEntryService.listCursor({
        sortBy: 'ext',
        sortOrder: 'asc',
        cursor: page2.nextCursor,
        limit: 1
      })

      expect([page1.items[0]?.name, page2.items[0]?.name, page3.items[0]?.name]).toEqual([
        'no-ext-a',
        'no-ext-b',
        'text'
      ])
      expect(page3.nextCursor).toBeUndefined()
    })

    it('sortBy=ext cursor pagination has no overlap or misses across pages', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-0000000000d9' as FileEntryId,
          origin: 'internal',
          name: 'text',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-0000000000da' as FileEntryId,
          origin: 'internal',
          name: 'no-ext',
          ext: null,
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        },
        {
          id: '019606a0-0000-7000-8000-0000000000db' as FileEntryId,
          origin: 'internal',
          name: 'pdf',
          ext: 'pdf',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 2,
          updatedAt: now + 2
        },
        {
          id: '019606a0-0000-7000-8000-0000000000dc' as FileEntryId,
          origin: 'internal',
          name: 'markdown',
          ext: 'md',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 3,
          updatedAt: now + 3
        }
      ])

      const page1 = await fileEntryService.listCursor({ sortBy: 'ext', sortOrder: 'asc', limit: 2 })
      const page2 = await fileEntryService.listCursor({
        sortBy: 'ext',
        sortOrder: 'asc',
        cursor: page1.nextCursor,
        limit: 2
      })

      const seen = [...page1.items, ...page2.items].map((e) => e.name)
      expect(seen).toEqual(['no-ext', 'markdown', 'pdf', 'text'])
      expect(new Set(seen).size).toBe(4)
      expect(page2.nextCursor).toBeUndefined()
    })

    it('returns { items: [], total: 0 } on an empty table', async () => {
      const result = await fileEntryService.listCursor()
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.nextCursor).toBeUndefined()
    })

    /**
     * Tie-breaker coverage: without a secondary `ORDER BY id`, SQLite's row
     * order for equal sort values is unspecified, so cursor pagination over
     * ties can surface the same row twice across pages or drop a row entirely.
     * These tests pin the deterministic-across-pages contract — page1 ∪ page2
     * must equal the full row set, no duplicates, no misses — for both sort
     * directions.
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
            deletedAt: null,
            createdAt: sharedTs,
            updatedAt: sharedTs
          }))
        )
        return ids
      }

      it('asc: pages over rows with identical createdAt have no overlap and miss nothing', async () => {
        const ids = await seedSameCreatedAt()
        const page1 = await fileEntryService.listCursor({ limit: 2 })
        const page2 = await fileEntryService.listCursor({ cursor: page1.nextCursor, limit: 2 })

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
            deletedAt: null,
            createdAt: sharedTs,
            updatedAt: sharedTs
          }))
        )

        const page1 = await fileEntryService.listCursor({ sortBy: 'name', sortOrder: 'desc', limit: 2 })
        const page2 = await fileEntryService.listCursor({
          sortBy: 'name',
          sortOrder: 'desc',
          cursor: page1.nextCursor,
          limit: 2
        })

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

  describe('getStats', () => {
    it('returns active extension counts and trash total', async () => {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: '019606a0-0000-7000-8000-000000000901' as FileEntryId,
          origin: 'internal',
          name: 'internal-md',
          ext: 'md',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000902' as FileEntryId,
          origin: 'internal',
          name: 'no-ext',
          ext: null,
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000903' as FileEntryId,
          origin: 'internal',
          name: 'trashed',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: now,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000904' as FileEntryId,
          origin: 'external',
          name: 'a',
          ext: 'txt',
          size: null,
          externalPath: '/Users/me/docs/a.txt',
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000905' as FileEntryId,
          origin: 'external',
          name: 'b',
          ext: 'md',
          size: null,
          externalPath: '/Users/me/docs/b.md',
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: '019606a0-0000-7000-8000-000000000906' as FileEntryId,
          origin: 'external',
          name: 'song',
          ext: 'mp3',
          size: null,
          externalPath: 'C:\\Users\\me\\Music\\song.mp3',
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        }
      ])

      const stats = await fileEntryService.getStats()
      const extCounts = new Map(stats.extCounts.map((row) => [row.ext, row.count]))
      expect(stats.activeTotal).toBe(5)
      expect(stats.trashTotal).toBe(1)
      expect(extCounts.get('md')).toBe(2)
      expect(extCounts.get('txt')).toBe(1)
      expect(extCounts.get('mp3')).toBe(1)
      expect(extCounts.get(null)).toBe(1)
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
        size: 11
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
      const entry = await fileEntryService.create({
        origin: 'external',
        name: 'doc',
        ext: 'pdf',
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

    it('throws when external row has non-null size (schema mirrors fe_size_internal_only)', async () => {
      await expect(
        fileEntryService.create({
          origin: 'external',
          name: 'doc',
          ext: 'pdf',
          size: 100,
          externalPath: '/Users/me/doc2.pdf'
        } as never)
      ).rejects.toThrow()
    })

    it('rejects unsafe ext BEFORE the SQL INSERT commits', async () => {
      const id = '019606a0-0000-7000-8000-000000000a05' as FileEntryId

      await expect(
        fileEntryService.create({
          id,
          origin: 'internal',
          name: 'payload',
          ext: 'exe ',
          size: 1
        })
      ).rejects.toThrow()

      const raw = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id))
      expect(raw).toHaveLength(0)
    })

    it('throws when internal row has externalPath (schema mirrors fe_origin_consistency)', async () => {
      const id = '019606a0-0000-7000-8000-000000000a04' as FileEntryId
      await expect(
        fileEntryService.create({
          id,
          origin: 'internal',
          name: 'note',
          ext: 'txt',
          size: 1,
          externalPath: '/some/path'
        } as never)
      ).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('updates name and refreshes updatedAt', async () => {
      const id = '019606a0-0000-7000-8000-000000000b01' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'old', ext: 'txt', size: 1 })
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

    it('updates deletedAt for soft delete', async () => {
      const id = '019606a0-0000-7000-8000-000000000b02' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'tmp', ext: 'txt', size: 1 })
      const deletedAt = Date.now()
      const updated = await fileEntryService.update(id, { deletedAt })
      if (updated.origin !== 'internal') throw new Error('expected internal entry')
      expect(updated.deletedAt).toBe(deletedAt)
    })

    it('throws when setting deletedAt on an external row (CHECK fe_external_no_delete)', async () => {
      const entry = await fileEntryService.create({
        origin: 'external',
        name: 'ext',
        ext: 'txt',
        externalPath: '/x/y.txt'
      })
      await expect(fileEntryService.update(entry.id, { deletedAt: Date.now() })).rejects.toThrow()
    })

    it('rejects unsafe name BEFORE the SQL UPDATE commits', async () => {
      // Regression: without the pre-SQL SafeNameSchema.parse, an unsafe
      // name (null byte, path separators, `..`, > 255 chars) hits SQLite
      // unchanged and only fails at the `rowToFileEntry` parse — leaving
      // the row permanently un-parseable. Pin the contract by reading the
      // row back with a raw SELECT after the rejection and asserting the
      // `name` column is unchanged.
      const id = '019606a0-0000-7000-8000-000000000b04' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'safe', ext: 'txt', size: 1 })

      await expect(fileEntryService.update(id, { name: 'has\0null' })).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id))
      expect(raw?.name).toBe('safe')
    })

    it('rejects unsafe ext BEFORE the SQL UPDATE commits', async () => {
      const id = '019606a0-0000-7000-8000-000000000b05' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'safe', ext: 'txt', size: 1 })

      await expect(fileEntryService.update(id, { ext: 'txt.' })).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id))
      expect(raw?.ext).toBe('txt')
    })
  })

  describe('listAllIds', () => {
    // listAllIds backs the Phase 1b.4 startup disk scan, which decides which
    // on-disk UUID files are orphaned (no DB row, regardless of trashed
    // state). The implementation is one query — the regressions worth
    // catching are misclassifying trashed rows as deleted (deletedAt filter
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
        size: 1
      })
      await fileEntryService.create({
        id: trashed,
        origin: 'internal',
        name: 't',
        ext: 'txt',
        size: 1
      })
      await fileEntryService.update(trashed, { deletedAt: Date.now() })

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
      const entry = await fileEntryService.create({
        origin: 'external',
        name: 'old-doc',
        ext: 'pdf',
        externalPath: '/Users/me/old-doc.pdf'
      })
      const id = entry.id
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
      const entry = await fileEntryService.create({
        origin: 'external',
        name: 'safe',
        ext: 'txt',
        externalPath: '/Users/me/safe.txt'
      })

      await expect(
        fileEntryService.setExternalPathAndName(entry.id, '/Users/me/legit.txt' as CanonicalExternalPath, '../evil')
      ).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, entry.id))
      expect(raw?.name).toBe('safe')
      expect(raw?.externalPath).toBe('/Users/me/safe.txt')
    })

    it('rejects unsafe externalPath BEFORE the SQL UPDATE commits', async () => {
      // The `CanonicalExternalPath` brand is TS-only and offers no runtime
      // guarantee. The service-side `AbsolutePathSchema.parse(externalPath)`
      // catches null bytes / non-absolute paths regardless of whether the
      // caller went through `canonicalizeExternalPath` or `as`-cast.
      const entry = await fileEntryService.create({
        origin: 'external',
        name: 'safe',
        ext: 'txt',
        externalPath: '/Users/me/safe.txt'
      })

      await expect(
        fileEntryService.setExternalPathAndName(entry.id, '/Users/me/null\0byte.txt' as CanonicalExternalPath, 'fine')
      ).rejects.toThrow()

      const [raw] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, entry.id))
      expect(raw?.name).toBe('safe')
      expect(raw?.externalPath).toBe('/Users/me/safe.txt')
    })

    it('throws on fe_external_path_unique_idx conflict (race against a concurrent rename to the same path)', async () => {
      // Two external entries racing to claim the same canonical path: the
      // unique index rejects the second UPDATE with a SQLite constraint
      // failure. Callers that catch only "not found"-shaped errors would
      // otherwise see this as an unhandled rejection.
      await fileEntryService.create({
        origin: 'external',
        name: 'a',
        ext: 'txt',
        externalPath: '/Users/me/a.txt'
      })
      const b = await fileEntryService.create({
        origin: 'external',
        name: 'b',
        ext: 'txt',
        externalPath: '/Users/me/b.txt'
      })

      // Drizzle wraps the SQLite constraint error in its own "Failed query: …"
      // shape, so we don't pin a specific keyword. The contract DeJeune flagged
      // is the negative one: this is NOT a "not found"-shaped error, so callers
      // catching only that branch will correctly surface this case as
      // unexpected and bubble it up.
      const err = await fileEntryService
        .setExternalPathAndName(b.id, '/Users/me/a.txt' as CanonicalExternalPath, 'a')
        .then(
          () => null,
          (e: Error) => e
        )
      expect(err).toBeInstanceOf(Error)
      expect(err?.message).not.toMatch(/not found/i)
      // The conflicting entry is unchanged after the failed mutation
      const refetched = await fileEntryService.getById(b.id)
      if (refetched.origin !== 'external') throw new Error('expected external entry')
      expect(refetched.externalPath).toBe('/Users/me/b.txt')
    })
  })

  describe('delete', () => {
    it('routes public write wrappers through DbService.withWriteTx', async () => {
      const withWriteTx = MockMainDbServiceExport.dbService.withWriteTx
      withWriteTx.mockClear()

      const internalId = '019606a0-0000-7000-8000-000000000c10' as FileEntryId
      await fileEntryService.create({ id: internalId, origin: 'internal', name: 'tx', ext: 'txt', size: 1 })
      await fileEntryService.update(internalId, { name: 'tx-renamed' })
      await fileEntryService.delete(internalId)

      const external = await fileEntryService.create({
        origin: 'external',
        name: 'ext-tx',
        ext: 'txt',
        externalPath: '/Users/me/ext-tx.txt'
      })
      await fileEntryService.setExternalPathAndName(
        external.id,
        '/Users/me/ext-tx-renamed.txt' as CanonicalExternalPath,
        'ext-tx-renamed'
      )

      expect(withWriteTx).toHaveBeenCalledTimes(5)
    })

    it('removes an existing row', async () => {
      const id = '019606a0-0000-7000-8000-000000000c01' as FileEntryId
      await fileEntryService.create({ id, origin: 'internal', name: 'd', ext: 'txt', size: 1 })
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
      const paintingId = '11111111-1111-4111-8111-' + fileEntryId.slice(-12)
      await dbh.db.insert(paintingTable).values({
        id: paintingId,
        providerId: 'provider',
        modelId: null,
        prompt: 'prompt',
        orderKey: paintingId,
        createdAt: now,
        updatedAt: now
      })
      await dbh.db.insert(paintingFileRefTable).values({
        id: '22222222-2222-4222-8222-' + fileEntryId.slice(-12),
        fileEntryId,
        sourceId: paintingId,
        role: 'output',
        createdAt: now,
        updatedAt: now
      })
    }

    it('returns only entries with zero persistent refs', async () => {
      const referenced = '019606a0-0000-7000-8000-000000000d01' as FileEntryId
      const orphan = '019606a0-0000-7000-8000-000000000d02' as FileEntryId
      await fileEntryService.create({
        id: referenced,
        origin: 'internal',
        name: 'r',
        ext: 'txt',
        size: 1
      })
      await fileEntryService.create({
        id: orphan,
        origin: 'internal',
        name: 'o',
        ext: 'txt',
        size: 1
      })
      await seedRef(referenced)

      const result = await fileEntryService.findUnreferenced()
      const ids = result.map((e) => e.id)
      expect(ids).toEqual([orphan])
    })

    it('honours the optional origin filter', async () => {
      const internalOrphan = '019606a0-0000-7000-8000-000000000d11' as FileEntryId
      await fileEntryService.create({
        id: internalOrphan,
        origin: 'internal',
        name: 'i',
        ext: 'txt',
        size: 1
      })
      const externalOrphan = await fileEntryService.create({
        origin: 'external',
        name: 'e',
        ext: 'txt',
        externalPath: '/abs/orphan.txt' as CanonicalExternalPath
      })

      const externalsOnly = await fileEntryService.findUnreferenced({ origin: 'external' })
      expect(externalsOnly.map((e) => e.id)).toEqual([externalOrphan.id])

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
        size: 1
      })
      await fileEntryService.update(id, { deletedAt: Date.now() })

      const result = await fileEntryService.findUnreferenced()
      expect(result.find((e) => e.id === id)).toBeUndefined()
    })
  })

  describe('bulk-read fault isolation (#15733)', () => {
    const goodId = '019606a0-0000-7000-8000-00000000aa01' as FileEntryId
    const badId = '019606a0-0000-7000-8000-00000000aa02' as FileEntryId

    async function seedOneGoodOneBad() {
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: goodId,
          origin: 'internal',
          name: 'good',
          ext: 'txt',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          // Simulates pre-fix FileMigrator output: a name carrying path
          // separators. No DB CHECK guards `name`, so it inserts cleanly
          // and only SafeNameSchema rejects it at read time.
          id: badId,
          origin: 'internal',
          name: 'C:\\Users\\x\\bad',
          ext: 'png',
          size: 1,
          externalPath: null,
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        }
      ])
    }

    it('findMany returns parseable rows and warns once per bad row', async () => {
      await seedOneGoodOneBad()
      mockMainLoggerService.warn.mockClear()

      const entries = await fileEntryService.findMany()
      expect(entries.map((e) => e.id)).toEqual([goodId])
      expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('un-parseable'),
        expect.objectContaining({ id: badId })
      )
    })

    it('findById still throws for the bad row; good rows unaffected', async () => {
      await seedOneGoodOneBad()
      await expect(fileEntryService.findById(badId)).rejects.toThrow()
      await expect(fileEntryService.findById(goodId)).resolves.toMatchObject({ id: goodId })
    })

    it('listCursor excludes bad rows from items while total still counts them', async () => {
      await seedOneGoodOneBad()
      const page = await fileEntryService.listCursor()
      expect(page.items.map((e) => e.id)).toEqual([goodId])
      expect(page.total).toBe(2)
    })

    it('findUnreferenced skips bad rows', async () => {
      await seedOneGoodOneBad()
      const entries = await fileEntryService.findUnreferenced()
      expect(entries.map((e) => e.id)).toEqual([goodId])
    })

    it('findCaseInsensitivePeers isolates a corrupt external row instead of throwing', async () => {
      // The functional unique index `fe_external_path_lower_unique_idx`
      // makes "a good and a bad row sharing a case-insensitive
      // externalPath" unrepresentable, so the corrupt row IS the only
      // possible match for its path: fault isolation must turn the
      // would-be throw into an empty result plus one warning.
      const badExternalId = '019606a0-0000-7000-8000-00000000aa03' as FileEntryId
      const goodExternalId = '019606a0-0000-7000-8000-00000000aa04' as FileEntryId
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values([
        {
          id: badExternalId,
          origin: 'external',
          name: 'C:\\Users\\x\\bad-peer',
          ext: 'txt',
          size: null,
          externalPath: '/Users/me/BAD-PEER.TXT',
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: goodExternalId,
          origin: 'external',
          name: 'good-peer',
          ext: 'txt',
          size: null,
          externalPath: '/Users/me/GOOD-PEER.TXT',
          deletedAt: null,
          createdAt: now + 1,
          updatedAt: now + 1
        }
      ])
      mockMainLoggerService.warn.mockClear()

      // Corrupt match → excluded with one warning, not a throw.
      const badPeers = await fileEntryService.findCaseInsensitivePeers(
        '/users/me/bad-peer.txt' as CanonicalExternalPath
      )
      expect(badPeers).toEqual([])
      expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('un-parseable'),
        expect.objectContaining({ id: badExternalId })
      )

      // Good rows still surface through the same method.
      const goodPeers = await fileEntryService.findCaseInsensitivePeers(
        '/users/me/good-peer.txt' as CanonicalExternalPath
      )
      expect(goodPeers.map((e) => e.id)).toEqual([goodExternalId])
    })
  })
})

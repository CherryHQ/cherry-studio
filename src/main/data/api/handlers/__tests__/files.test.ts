import { fileEntryTable } from '@data/db/schemas/file'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { FileEntryStats } from '@shared/data/api/schemas/files'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { fileHandlers } = await import('../files')
const { fileRefService } = await import('@data/services/FileRefService')

describe('fileHandlers (DataApi)', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
  })

  async function seedEntry(id: string, overrides: Partial<typeof fileEntryTable.$inferInsert> = {}) {
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'n',
      ext: 'txt',
      size: 1,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides
    })
  }

  describe('GET /files/entries', () => {
    it('returns paginated active entries with total count', async () => {
      await Promise.all([
        seedEntry('019606a0-0000-7000-8000-000000000a01'),
        seedEntry('019606a0-0000-7000-8000-000000000a02'),
        seedEntry('019606a0-0000-7000-8000-000000000a03', { deletedAt: Date.now() })
      ])

      const result = (await fileHandlers['/files/entries'].GET({ query: {} } as never)) as {
        items: unknown[]
        total: number
        nextCursor?: string
      }
      expect(result.items.length).toBe(2)
      expect(result.total).toBe(2)
      expect(result.nextCursor).toBeUndefined()
    })

    it('filters by origin and applies cursor pagination', async () => {
      await Promise.all([
        seedEntry('019606a0-0000-7000-8000-000000000a10', { origin: 'internal', name: 'a' }),
        seedEntry('019606a0-0000-7000-8000-000000000a11', { origin: 'internal', name: 'b' }),
        seedEntry('019606a0-0000-7000-8000-000000000a12', {
          origin: 'external',
          name: 'c',
          size: null,
          externalPath: '/foo/c.txt'
        })
      ])

      const result = (await fileHandlers['/files/entries'].GET({
        query: { origin: 'external', limit: 10 }
      } as never)) as { items: Array<{ origin: string }>; total: number; nextCursor?: string }
      expect(result.items.length).toBe(1)
      expect(result.items[0].origin).toBe('external')
      expect(result.nextCursor).toBeUndefined()
    })

    it('sorts by extension for the file type column', async () => {
      await Promise.all([
        seedEntry('019606a0-0000-7000-8000-000000000a20', { name: 'image', ext: 'png' }),
        seedEntry('019606a0-0000-7000-8000-000000000a21', { name: 'audio', ext: 'mp3' }),
        seedEntry('019606a0-0000-7000-8000-000000000a22', { name: 'text', ext: 'txt' })
      ])

      const result = (await fileHandlers['/files/entries'].GET({
        query: { sortBy: 'ext', sortOrder: 'asc', limit: 10 }
      } as never)) as { items: Array<{ name: string; ext: string }> }
      expect(result.items.map((item) => item.ext)).toEqual(['mp3', 'png', 'txt'])
    })

    it('rejects limit above the MAX cap with ZodError', async () => {
      // Without a `.max()` on the query schema, a caller could ask for an
      // unbounded cursor page (DoS surface against the SELECT). Pin the upper bound.
      await expect(fileHandlers['/files/entries'].GET({ query: { limit: 999 } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
    })

    it('rejects non-positive limit and unknown page with ZodError', async () => {
      await expect(fileHandlers['/files/entries'].GET({ query: { limit: 0 } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      await expect(fileHandlers['/files/entries'].GET({ query: { page: 0 } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
    })
  })

  describe('GET /files/entries/stats', () => {
    it('returns pure SQL sidebar counts', async () => {
      const now = Date.now()
      await Promise.all([
        seedEntry('019606a0-0000-7000-8000-000000000aa1', { ext: 'md' }),
        seedEntry('019606a0-0000-7000-8000-000000000aa2', {
          origin: 'external',
          name: 'external',
          ext: 'txt',
          size: null,
          externalPath: '/tmp/files/external.txt'
        }),
        seedEntry('019606a0-0000-7000-8000-000000000aa3', { deletedAt: now })
      ])

      const result = (await fileHandlers['/files/entries/stats'].GET({} as never)) as unknown as FileEntryStats
      expect(result.activeTotal).toBe(2)
      expect(result.trashTotal).toBe(1)
      expect(result.extCounts).toEqual(
        expect.arrayContaining([
          { ext: 'md', count: 1 },
          { ext: 'txt', count: 1 }
        ])
      )
    })
  })

  describe('GET /files/entries/:id', () => {
    it('returns the entry by id', async () => {
      const id = '019606a0-0000-7000-8000-000000000b01'
      await seedEntry(id)
      const entry = (await fileHandlers['/files/entries/:id'].GET({
        params: { id: id as FileEntryId }
      } as never)) as { id: string }
      expect(entry.id).toBe(id)
    })

    it('throws DataApiError(NOT_FOUND) when the id does not exist', async () => {
      // Regression: prior to the findById + DataApiErrorFactory.notFound fix
      // this path threw a plain Error, which toDataApiError routed through
      // internal() → HTTP 500. Renderer-side not-found branching would never
      // see NOT_FOUND. Pin both the code and the resource shape so a future
      // "throw a generic error" regression is caught at the schema boundary.
      const missing = '019606a0-0000-7000-8000-0000000000ff' as FileEntryId
      const promise = fileHandlers['/files/entries/:id'].GET({ params: { id: missing } } as never)
      await expect(promise).rejects.toBeInstanceOf(DataApiError)
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'FileEntry', id: missing }
      })
    })

    it('rejects a non-UUIDv7 id with ZodError before reaching the service', async () => {
      // FileEntryId is a brand alias for `string` — without the handler-level
      // parse, a malformed id reaches the DB layer and surfaces as either an
      // opaque NOT_FOUND or an internal error. `fileEntry.ts:99-104` requires
      // handlers to validate at the boundary; this test pins that contract.
      await expect(
        fileHandlers['/files/entries/:id'].GET({ params: { id: 'not-a-uuid' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
    })
  })

  describe('GET /files/entries/ref-counts', () => {
    it('returns refCount=0 for ids with no refs and counts existing refs', async () => {
      const idA = '019606a0-0000-7000-8000-000000000c01' as FileEntryId
      const idB = '019606a0-0000-7000-8000-000000000c02' as FileEntryId
      await seedEntry(idA)
      await seedEntry(idB)
      await fileRefService.createManyTempSessionRefs([
        { fileEntryId: idA, sourceId: 's1', role: 'pending' },
        { fileEntryId: idA, sourceId: 's2', role: 'pending' }
      ])

      const result = (await fileHandlers['/files/entries/ref-counts'].GET({
        query: { entryIds: [idA, idB] }
      } as never)) as Array<{ entryId: string; refCount: number }>
      expect(result.find((r) => r.entryId === idA)?.refCount).toBe(2)
      expect(result.find((r) => r.entryId === idB)?.refCount).toBe(0)
    })

    it('rejects entryIds containing non-UUID strings with ZodError', async () => {
      await expect(
        fileHandlers['/files/entries/ref-counts'].GET({
          query: { entryIds: ['not-a-uuid'] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
    })

    it('rejects entryIds batches larger than REF_COUNTS_MAX_ENTRY_IDS with ZodError', async () => {
      // Pin the renderer-side ceiling — otherwise a runaway batch would
      // fan-out into many service round-trips (the service still chunks
      // for SQLite, but it does so once per chunk).
      const ids = Array.from({ length: 501 }, (_, i) => `019606a0-0000-7000-8000-${String(i).padStart(12, '0')}`)
      await expect(
        fileHandlers['/files/entries/ref-counts'].GET({ query: { entryIds: ids } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
    })
  })

  describe('GET /files/entries/:id/refs', () => {
    it('returns refs for the entry', async () => {
      const id = '019606a0-0000-7000-8000-000000000d01' as FileEntryId
      await seedEntry(id)
      await fileRefService.createTempSessionRef({ fileEntryId: id, sourceId: 's1', role: 'pending' })
      const refs = (await fileHandlers['/files/entries/:id/refs'].GET({
        params: { id }
      } as never)) as Array<{ fileEntryId: string }>
      expect(refs.length).toBe(1)
      expect(refs[0].fileEntryId).toBe(id)
    })
  })

  describe('GET /files/refs', () => {
    it('returns refs filtered by source key', async () => {
      const id = '019606a0-0000-7000-8000-000000000e01' as FileEntryId
      await seedEntry(id)
      await fileRefService.createTempSessionRef({
        fileEntryId: id,
        sourceId: 'session-Z',
        role: 'pending'
      })
      const refs = (await fileHandlers['/files/refs'].GET({
        query: { sourceType: 'temp_session', sourceId: 'session-Z' }
      } as never)) as unknown[]
      expect(refs.length).toBe(1)
    })

    it('rejects an unregistered sourceType with ZodError', async () => {
      // sourceType must be one of the registered variants in `allSourceTypes`;
      // a stray literal here would otherwise be silently coerced through to
      // an empty SELECT and return [] instead of failing loudly.
      await expect(
        fileHandlers['/files/refs'].GET({
          query: { sourceType: 'unknown_source', sourceId: 'x' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
    })

    it('rejects an empty sourceId with ZodError', async () => {
      await expect(
        fileHandlers['/files/refs'].GET({
          query: { sourceType: 'temp_session', sourceId: '' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
    })
  })
})

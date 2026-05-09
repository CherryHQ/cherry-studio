import { fileEntryTable } from '@data/db/schemas/file'
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

    it('getById throws for missing id', async () => {
      await expect(fileEntryService.getById('019606a0-0000-7000-8000-9999fffffffe' as FileEntryId)).rejects.toThrow(
        /not found/i
      )
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
})

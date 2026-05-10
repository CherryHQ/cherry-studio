import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { write, writeIfUnchanged, writeByPath } = await import('../write')
const { createInternal, ensureExternal } = await import('../../entry/create')
const { StaleVersionError } = await import('../../../FileManager')

import type { FileVersion } from '../../../FileManager'
import type { FileManagerDeps } from '../../deps'

describe('internal/content/write', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps
  let cacheStore: Map<string, FileVersion>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-writetest-'))
    filesDir = path.join(tmp, 'Files')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(filesDir, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(filesDir, filename) : filesDir
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    cacheStore = new Map()
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: { check: vi.fn(), onFsEvent: vi.fn(), subscribe: vi.fn(() => () => {}), clear: vi.fn() },
      versionCache: {
        get: vi.fn((id) => cacheStore.get(id as string)),
        set: vi.fn((id, v) => {
          cacheStore.set(id as string, v as FileVersion)
        }),
        invalidate: vi.fn((id) => {
          cacheStore.delete(id as string)
        }),
        clear: vi.fn(() => cacheStore.clear())
      }
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  describe('write', () => {
    it('overwrites internal physical file and updates DB size', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'a',
        ext: 'bin'
      })
      const next = await write(deps, e.id, new Uint8Array([0x01, 0x02, 0x03]))
      expect(next.size).toBe(3)
      const refreshed = await fileEntryService.getById(e.id)
      expect(refreshed.size).toBe(3)
      expect(cacheStore.get(e.id)).toEqual(next)
    })

    it('overwrites external file content; DB size stays null for external rows', async () => {
      const file = path.join(tmp, 'ext.txt')
      await writeFile(file, 'old')
      const e = await ensureExternal(deps, { externalPath: file as FilePath })
      const next = await write(deps, e.id, 'new-payload')
      expect(next.size).toBe('new-payload'.length)
      expect(await readFile(file, 'utf-8')).toBe('new-payload')
      const refreshed = await fileEntryService.getById(e.id)
      expect(refreshed.size).toBeNull()
    })
  })

  describe('writeIfUnchanged', () => {
    it('writes when expected matches current', async () => {
      const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([1]), name: 'a', ext: 'bin' })
      const physical = path.join(filesDir, `${e.id}.bin`) as FilePath
      const { stat: fsStat } = await import('node:fs/promises')
      const s = await fsStat(physical)
      const expected: FileVersion = { mtime: Math.floor(s.mtimeMs), size: s.size }
      const next = await writeIfUnchanged(deps, e.id, new Uint8Array([1, 2]), expected)
      expect(next.size).toBe(2)
    })

    it('throws StaleVersionError on size mismatch', async () => {
      const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([1, 2, 3]), name: 'a', ext: 'bin' })
      await expect(writeIfUnchanged(deps, e.id, new Uint8Array([9]), { mtime: 1, size: 9999 })).rejects.toBeInstanceOf(
        StaleVersionError
      )
    })

    it('does NOT trust the cache — re-stats on every call', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([1, 2, 3]),
        name: 'a',
        ext: 'bin'
      })
      // Poison the cache with a stale version
      cacheStore.set(e.id, { mtime: 0, size: 9999 })
      const physical = path.join(filesDir, `${e.id}.bin`) as FilePath
      const { stat: fsStat } = await import('node:fs/promises')
      const s = await fsStat(physical)
      const expected: FileVersion = { mtime: Math.floor(s.mtimeMs), size: s.size }
      // Should still succeed because the OCC compare uses fresh stat, not the poisoned cache
      const next = await writeIfUnchanged(deps, e.id, 'next', expected)
      expect(next.size).toBe(4)
    })

    it('treats second-precision mtime + same size as match (no false positive)', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([1, 2, 3, 4]),
        name: 'a',
        ext: 'bin'
      })
      const physical = path.join(filesDir, `${e.id}.bin`) as FilePath
      await utimes(physical, 1700000000, 1700000000)
      const expected: FileVersion = { mtime: 1700000000_000, size: 4 }
      const next = await writeIfUnchanged(deps, e.id, new Uint8Array([5, 6, 7, 8]), expected)
      expect(next.size).toBe(4)
      expect(Array.from(await readFile(physical))).toEqual([5, 6, 7, 8])
    })
  })

  describe('writeByPath', () => {
    it('writes content to a path without DB or cache mutation', async () => {
      const target = path.join(tmp, 'naked.txt')
      await writeFile(target, 'old')
      await writeByPath(deps, target as FilePath, 'new-content')
      expect(await readFile(target, 'utf-8')).toBe('new-content')
      expect(cacheStore.size).toBe(0)
    })
  })
})

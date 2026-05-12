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

// Shared error spy: write.ts logs the post-commit metadata-sync failure
// through `loggerService.withContext('file/internal/write').error`. Every
// withContext caller in this test process gets the same vi.fn so the
// post-commit regression test can assert on it directly.
const mockLoggerError = vi.hoisted(() => vi.fn())
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: mockLoggerError
    })
  }
}))

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { createDefaultOrphanCheckerRegistry } = await import('@data/services/orphan/FileRefCheckerRegistry')
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
      danglingCache: {
        check: vi.fn(),
        onFsEvent: vi.fn(),
        addEntry: vi.fn(),
        removeEntry: vi.fn(),
        initFromDb: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        onDanglingStateChanged: vi.fn(() => ({ dispose: () => {} })),
        clear: vi.fn()
      },
      versionCache: {
        get: vi.fn((id) => cacheStore.get(id as string)),
        set: vi.fn((id, v) => {
          cacheStore.set(id as string, v as FileVersion)
        }),
        invalidate: vi.fn((id) => {
          cacheStore.delete(id as string)
        }),
        clear: vi.fn(() => cacheStore.clear())
      },
      orphanRegistry: createDefaultOrphanCheckerRegistry()
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
      // External BO has no `size` field by construction (live values come
      // from File IPC `getMetadata`). The DB row still stores `size: null`.
      expect(refreshed.origin).toBe('external')
      expect(refreshed).not.toHaveProperty('size')
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

    it('writes when expectedContentHash matches actual disk content (second-precision FS opt-in)', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([1, 2, 3, 4]),
        name: 'hash-match',
        ext: 'bin'
      })
      const physical = path.join(filesDir, `${e.id}.bin`) as FilePath
      await utimes(physical, 1700000000, 1700000000)
      // Caller pre-computed the hash from a prior read; supplies it to opt
      // into the hash fallback on this ambiguous-mtime filesystem.
      const { hash } = await import('@main/utils/file/fs')
      const actualHash = await hash(physical)
      const expected: FileVersion = { mtime: 1700000000_000, size: 4 }
      const next = await writeIfUnchanged(deps, e.id, new Uint8Array([9, 8, 7, 6]), expected, actualHash)
      expect(next.size).toBe(4)
      expect(Array.from(await readFile(physical))).toEqual([9, 8, 7, 6])
    })

    it('throws StaleVersionError when expectedContentHash mismatches actual disk content', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([1, 2, 3, 4]),
        name: 'hash-mismatch',
        ext: 'bin'
      })
      const physical = path.join(filesDir, `${e.id}.bin`) as FilePath
      await utimes(physical, 1700000000, 1700000000)
      const expected: FileVersion = { mtime: 1700000000_000, size: 4 }
      // Wrong xxhash-h64 hex (16 chars). With ambiguous mtime + matching size,
      // the implementation must fall back to hash comparison and reject.
      const wrongHash = 'deadbeefdeadbeef'
      await expect(
        writeIfUnchanged(deps, e.id, new Uint8Array([9, 8, 7, 6]), expected, wrongHash)
      ).rejects.toBeInstanceOf(StaleVersionError)
      // Original content untouched
      expect(Array.from(await readFile(physical))).toEqual([1, 2, 3, 4])
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

  describe('createWriteStream post-commit metadata sync', () => {
    it('updates DB size and version cache after the stream finishes (internal)', async () => {
      const { createWriteStream } = await import('../write')
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'b',
        ext: 'bin'
      })
      const stream = await createWriteStream(deps, e.id)
      const payload = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50])
      stream.write(payload)
      stream.end()
      await new Promise<void>((resolve, reject) => {
        stream.once('finish', () => {
          // The 'finish' handler is a microtask chain; let the post-commit
          // hook drain before asserting.
          setImmediate(resolve)
        })
        stream.once('error', reject)
      })
      // Give the post-commit async catch handler one more tick to settle.
      await new Promise<void>((r) => setImmediate(r))
      const refreshed = await fileEntryService.getById(e.id)
      expect(refreshed.size).toBe(payload.length)
      expect(cacheStore.get(e.id)?.size).toBe(payload.length)
    })

    it('keeps DB size null for external entries after the stream finishes', async () => {
      const { createWriteStream } = await import('../write')
      const file = path.join(tmp, 'ext-stream.txt')
      await writeFile(file, 'seed')
      const e = await ensureExternal(deps, { externalPath: file as FilePath })
      const stream = await createWriteStream(deps, e.id)
      stream.write(Buffer.from('updated payload'))
      stream.end()
      await new Promise<void>((resolve, reject) => {
        stream.once('finish', () => setImmediate(resolve))
        stream.once('error', reject)
      })
      await new Promise<void>((r) => setImmediate(r))
      const refreshed = await fileEntryService.getById(e.id)
      // External rows must keep size=null per the schema CHECK; only the cache reflects the new version.
      expect(refreshed.size).toBeNull()
      expect(cacheStore.get(e.id)?.size).toBe('updated payload'.length)
    })

    it('error-logs WRITE_STREAM_DB_DESYNC when the post-commit re-stat fails', async () => {
      // Once the atomic rename commits, a failure in the re-stat / DB-size /
      // versionCache update silently desyncs disk and DB. The log must carry
      // the stable WRITE_STREAM_DB_DESYNC code and the full err object so
      // Sentry can group these — a downgrade to .message string would slip
      // through CI without this assertion.
      const { createWriteStream } = await import('../write')
      const fsModule = await import('@main/utils/file/fs')
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'desync',
        ext: 'bin'
      })
      mockLoggerError.mockClear()
      const statErr = new Error('post-commit stat boom')
      vi.spyOn(fsModule, 'stat').mockRejectedValue(statErr)
      const stream = await createWriteStream(deps, e.id)
      stream.write(Buffer.from('payload'))
      stream.end()
      await new Promise<void>((resolve, reject) => {
        stream.once('finish', () => setImmediate(resolve))
        stream.once('error', reject)
      })
      // Two microtask hops: the 'finish' handler kicks off the async post-
      // commit chain, the rejected stat resolves on the next tick.
      await new Promise<void>((r) => setImmediate(r))
      await new Promise<void>((r) => setImmediate(r))
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining('post-commit'),
        expect.objectContaining({
          code: 'WRITE_STREAM_DB_DESYNC',
          id: e.id,
          err: statErr
        })
      )
    })
  })
})

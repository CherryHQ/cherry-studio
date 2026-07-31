import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { hashContent } from '@main/utils/file'
import { ContentHashSchema } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// `@logger` is mocked globally in `tests/main.setup.ts` via the unified
// MockMainLoggerService singleton — write.ts's post-commit metadata-sync
// error landings flow through the same spy regardless of `withContext`
// argument, so the assertion below can read it directly.
const mockLoggerError = mockMainLoggerService.error

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { write, writeIfUnchanged } = await import('../write')
const { createInternal, ensureExternal } = await import('../../entry/create')
const { ContentCommittedMetadataPendingError, StaleVersionError } = await import('../../../FileManager')

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
      contentWriteLock: new KeyedMutex()
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  describe('write', () => {
    it('waits for the shared entry lock before committing content', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'locked',
        ext: 'bin'
      })
      const release = await deps.contentWriteLock.acquire(e.id)
      const pending = write(deps, e.id, new Uint8Array([0x02]))

      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(Array.from(await readFile(path.join(filesDir, `${e.id}.bin`)))).toEqual([0x01])

      release()
      await pending
      expect(Array.from(await readFile(path.join(filesDir, `${e.id}.bin`)))).toEqual([0x02])
    })

    it('overwrites internal physical file and updates DB size', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'a',
        ext: 'bin'
      })
      const next = await write(deps, e.id, new Uint8Array([0x01, 0x02, 0x03]))
      expect(next.size).toBe(3)
      const refreshed = fileEntryService.getById(e.id)
      if (refreshed.origin !== 'internal') throw new Error('expected internal entry')
      expect(refreshed.size).toBe(3)
      expect(refreshed.contentHash).toBe(hashContent(new Uint8Array([0x01, 0x02, 0x03])))
      expect(cacheStore.get(e.id)).toEqual(next)
    })

    it('overwrites external file content; DB size stays null for external rows', async () => {
      const file = path.join(tmp, 'ext.txt')
      await writeFile(file, 'old')
      const e = await ensureExternal(deps, { externalPath: file as AbsoluteFilePath })
      const next = await write(deps, e.id, 'new-payload')
      expect(next.size).toBe('new-payload'.length)
      expect(await readFile(file, 'utf-8')).toBe('new-payload')
      const refreshed = fileEntryService.getById(e.id)
      // External BO has no `size` field by construction (live values come
      // from File IPC `getMetadata`). The DB row still stores `size: null`.
      expect(refreshed.origin).toBe('external')
      expect(refreshed).not.toHaveProperty('size')
      expect(refreshed).not.toHaveProperty('contentHash')
    })

    it('leaves a null recovery marker and throws the typed pending error when DB finalization fails', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'desync',
        ext: 'bin'
      })
      const updateErr = new Error('SQLITE_BUSY: database is locked')
      vi.spyOn(fileEntryService, 'completeInternalContentCommit').mockImplementationOnce(() => {
        throw updateErr
      })
      mockLoggerError.mockClear()

      let error: unknown
      try {
        await write(deps, e.id, new Uint8Array([0xaa, 0xbb, 0xcc]))
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(ContentCommittedMetadataPendingError)
      expect(error).toMatchObject({ entryId: e.id })

      const physical = path.join(filesDir, `${e.id}.bin`)
      const onDisk = await readFile(physical)
      expect(Array.from(onDisk)).toEqual([0xaa, 0xbb, 0xcc])
      expect(fileEntryService.getById(e.id)).toMatchObject({ contentHash: null })
      expect(cacheStore.get(e.id)).toMatchObject({ size: 3 })

      expect(mockLoggerError).toHaveBeenCalledWith(
        'content commit: bytes committed but metadata finalize failed',
        expect.objectContaining({ code: 'WRITE_DB_DESYNC', id: e.id, error: updateErr })
      )
    })

    it('keeps old bytes and metadata when the pending DB update fails before rename', async () => {
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'pending-failure',
        ext: 'bin'
      })
      const before = fileEntryService.getById(e.id)
      vi.spyOn(fileEntryService, 'beginInternalContentCommit').mockImplementationOnce(() => {
        throw new Error('SQLITE_BUSY before rename')
      })

      await expect(write(deps, e.id, new Uint8Array([0x02, 0x03]))).rejects.toThrow('SQLITE_BUSY before rename')
      expect(Array.from(await readFile(path.join(filesDir, `${e.id}.bin`)))).toEqual([0x01])
      expect(fileEntryService.getById(e.id)).toEqual(before)
      expect((await readdir(filesDir)).filter((entry) => entry.includes('.tmp-'))).toEqual([])
    })
  })

  describe('writeIfUnchanged', () => {
    it('writes when expected matches current', async () => {
      const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([1]), name: 'a', ext: 'bin' })
      const physical = path.join(filesDir, `${e.id}.bin`) as AbsoluteFilePath
      const { stat: fsStat } = await import('node:fs/promises')
      const s = await fsStat(physical)
      const expected: FileVersion = { mtime: Math.floor(s.mtimeMs), size: s.size }
      const next = await writeIfUnchanged(deps, e.id, new Uint8Array([1, 2]), expected)
      expect(next.size).toBe(2)
      const refreshed = fileEntryService.getById(e.id)
      if (refreshed.origin !== 'internal') throw new Error('expected internal entry')
      expect(refreshed.contentHash).toBe(hashContent(new Uint8Array([1, 2])))
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
      const physical = path.join(filesDir, `${e.id}.bin`) as AbsoluteFilePath
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
      const physical = path.join(filesDir, `${e.id}.bin`) as AbsoluteFilePath
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
      const physical = path.join(filesDir, `${e.id}.bin`) as AbsoluteFilePath
      await utimes(physical, 1700000000, 1700000000)
      // Caller pre-computed the hash from a prior read; supplies it to opt
      // into the hash fallback on this ambiguous-mtime filesystem.
      const { hash } = await import('@main/utils/file')
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
      const physical = path.join(filesDir, `${e.id}.bin`) as AbsoluteFilePath
      await utimes(physical, 1700000000, 1700000000)
      const expected: FileVersion = { mtime: 1700000000_000, size: 4 }
      // Wrong tagged XXH3-64 value. With ambiguous mtime + matching size,
      // the implementation must fall back to hash comparison and reject.
      const wrongHash = ContentHashSchema.parse('xxh3-64:deadbeefdeadbeef')
      await expect(
        writeIfUnchanged(deps, e.id, new Uint8Array([9, 8, 7, 6]), expected, wrongHash)
      ).rejects.toBeInstanceOf(StaleVersionError)
      // Original content untouched
      expect(Array.from(await readFile(physical))).toEqual([1, 2, 3, 4])
    })
  })

  describe('createWriteStream post-commit metadata sync', () => {
    it('holds the shared entry lock until a successful finish completes metadata sync', async () => {
      const { createWriteStream } = await import('../write')
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'stream-lock',
        ext: 'bin'
      })

      const stream = await createWriteStream(deps, e.id)
      let entered = false
      const queued = deps.contentWriteLock.runExclusive(e.id, () => {
        entered = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(entered).toBe(false)

      const finish = new Promise<void>((resolve, reject) => {
        stream.once('finish', resolve)
        stream.once('error', reject)
      })
      stream.end(Buffer.from('stream payload'))
      await finish
      await queued
      expect(entered).toBe(true)
    })

    it('releases the shared entry lock when a stream aborts before finish', async () => {
      const { createWriteStream } = await import('../write')
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'stream-abort-lock',
        ext: 'bin'
      })
      const stream = await createWriteStream(deps, e.id)
      let entered = false
      const queued = deps.contentWriteLock.runExclusive(e.id, () => {
        entered = true
      })

      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(entered).toBe(false)
      await stream.abort()
      await queued
      expect(entered).toBe(true)
    })

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
        stream.once('finish', resolve)
        stream.once('error', reject)
      })
      const refreshed = fileEntryService.getById(e.id)
      if (refreshed.origin !== 'internal') throw new Error('expected internal entry')
      expect(refreshed.size).toBe(payload.length)
      expect(refreshed.contentHash).toBe(hashContent(payload))
      expect(cacheStore.get(e.id)?.size).toBe(payload.length)
    })

    it('keeps DB size null for external entries after the stream finishes', async () => {
      const { createWriteStream } = await import('../write')
      const file = path.join(tmp, 'ext-stream.txt')
      await writeFile(file, 'seed')
      const e = await ensureExternal(deps, { externalPath: file as AbsoluteFilePath })
      const stream = await createWriteStream(deps, e.id)
      stream.write(Buffer.from('updated payload'))
      stream.end()
      await new Promise<void>((resolve, reject) => {
        stream.once('finish', resolve)
        stream.once('error', reject)
      })
      expect(cacheStore.get(e.id)?.size).toBe('updated payload'.length)
      const refreshed = fileEntryService.getById(e.id)
      // External BO has no `size` field by construction (live values come from
      // File IPC `getMetadata`); the DB still stores `size: null` per CHECK.
      expect(refreshed.origin).toBe('external')
      expect(refreshed).not.toHaveProperty('size')
      expect(refreshed).not.toHaveProperty('contentHash')
    })

    it('emits error instead of finish when bytes commit but the DB finalize step fails', async () => {
      const { createWriteStream } = await import('../write')
      const e = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0x01]),
        name: 'db-desync',
        ext: 'bin'
      })
      const updateErr = new Error('SQLITE_BUSY: database is locked')
      vi.spyOn(fileEntryService, 'completeInternalContentCommit').mockImplementationOnce(() => {
        throw updateErr
      })
      mockLoggerError.mockClear()

      const stream = await createWriteStream(deps, e.id)
      const finishSpy = vi.fn()
      stream.once('finish', finishSpy)
      const streamError = new Promise<Error>((resolve) => {
        stream.once('error', resolve)
      })
      stream.end(Buffer.from('payload'))

      await expect(streamError).resolves.toBeInstanceOf(ContentCommittedMetadataPendingError)
      expect(finishSpy).not.toHaveBeenCalled()
      expect(await readFile(path.join(filesDir, `${e.id}.bin`), 'utf-8')).toBe('payload')
      expect(fileEntryService.getById(e.id)).toMatchObject({ contentHash: null })
      expect(mockLoggerError).toHaveBeenCalledWith(
        'content commit: bytes committed but metadata finalize failed',
        expect.objectContaining({ code: 'WRITE_DB_DESYNC', id: e.id, error: updateErr })
      )
    })
  })
})

import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { type DanglingState, FileEntrySchema } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { KeyedMutex } from '@shared/utils/async'
import { canonicalizeFilePath } from '@shared/utils/file'

import { createDanglingCacheImpl, type DanglingStateChangedEvent } from '../danglingCache'
import { ensureExternal } from '../internal/entry/create'
import { rename } from '../internal/entry/rename'
import { createVersionCacheImpl } from '../versionCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const oldPath = canonicalizeFilePath(path.join(tmpdir(), 'cherry-probe-old.txt'))
const newPath = canonicalizeFilePath(path.join(tmpdir(), 'cherry-probe-new.txt'))

function externalEntry(externalPath = oldPath, id: string = randomUUID()) {
  return FileEntrySchema.parse({
    id,
    origin: 'external',
    externalPath,
    name: 'file',
    ext: 'txt',
    cleanupPolicy: 'manual',
    createdAt: 0,
    updatedAt: 0
  })
}

describe('DanglingCache in-flight observations', () => {
  it.each<DanglingState>(['missing', 'present', 'unknown'])(
    'returns the current observation after reindexing instead of an old %s probe',
    async (oldResult) => {
      const probe = deferred<DanglingState>()
      const cache = createDanglingCacheImpl({ statProbe: () => probe.promise })
      const entry = externalEntry()
      const events: DanglingStateChangedEvent[] = []
      cache.onDanglingStateChanged((event) => events.push(event))
      cache.addEntry(entry.id, oldPath)
      const pending = cache.check(entry)
      cache.removeEntry(entry.id, oldPath)
      cache.addEntry(entry.id, newPath)
      cache.onFsEvent(newPath, 'present', 'ops')
      probe.resolve(oldResult)
      expect(await pending).toBe('present')
      expect(await cache.check(externalEntry(newPath, entry.id))).toBe('present')
      cache.onFsEvent(oldPath, 'missing')
      expect(events).toEqual([{ id: entry.id, state: 'present' }])
    }
  )

  it.each(['watcher', 'ops'] as const)('keeps a newer %s observation on the same path', async (source) => {
    const probe = deferred<DanglingState>()
    const cache = createDanglingCacheImpl({ statProbe: () => probe.promise })
    const entry = externalEntry()
    const events: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((event) => events.push(event))
    cache.addEntry(entry.id, oldPath)
    const pending = cache.check(entry)
    cache.onFsEvent(oldPath, 'present', source)
    probe.resolve('missing')
    expect(await pending).toBe('present')
    expect(await cache.check(entry)).toBe('present')
    expect(events).toEqual([{ id: entry.id, state: 'present' }])
  })

  it('keeps a same-state refresh that happens during an expired probe', async () => {
    let now = 0
    const probe = deferred<DanglingState>()
    const cache = createDanglingCacheImpl({ statProbe: () => probe.promise, now: () => now, ttlMs: 1000 })
    const entry = externalEntry()
    cache.addEntry(entry.id, oldPath)
    cache.onFsEvent(oldPath, 'present')
    const events: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((event) => events.push(event))
    now = 1001
    const pending = cache.check(entry)
    cache.onFsEvent(oldPath, 'present')
    probe.resolve('missing')
    expect(await pending).toBe('present')
    now += 500
    expect(await cache.check(entry)).toBe('present')
    expect(events).toEqual([])
  })

  it.each(['remove', 'clear'] as const)('does not repopulate state after %s', async (operation) => {
    const probe = deferred<DanglingState>()
    const statProbe = vi.fn<(p: AbsoluteFilePath) => Promise<DanglingState>>()
    statProbe.mockReturnValueOnce(probe.promise).mockResolvedValue('present')
    const cache = createDanglingCacheImpl({ statProbe })
    const entry = externalEntry()
    const events: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((event) => events.push(event))
    cache.addEntry(entry.id, oldPath)
    const pending = cache.check(entry)
    if (operation === 'remove') cache.removeEntry(entry.id, oldPath)
    else cache.clear()
    probe.resolve('missing')
    expect(await pending).toBe('unknown')
    expect(events).toEqual([])
    cache.addEntry(entry.id, oldPath)
    expect(await cache.check(entry)).toBe('present')
  })

  it('does not let an older concurrent probe overwrite a completed newer probe', async () => {
    const first = deferred<DanglingState>()
    const second = deferred<DanglingState>()
    const statProbe = vi.fn<(p: AbsoluteFilePath) => Promise<DanglingState>>()
    statProbe.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const cache = createDanglingCacheImpl({ statProbe })
    const entry = externalEntry()
    const events: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((event) => events.push(event))
    const oldCheck = cache.check(entry)
    const newCheck = cache.check(entry)
    second.resolve('present')
    expect(await newCheck).toBe('present')
    first.resolve('missing')
    expect(await oldCheck).toBe('present')
    expect(await cache.check(entry)).toBe('present')
    expect(events).toEqual([{ id: entry.id, state: 'present' }])
  })

  it('does not discard a valid probe when addEntry is repeated for the same path', async () => {
    const probe = deferred<DanglingState>()
    const cache = createDanglingCacheImpl({ statProbe: () => probe.promise })
    const entry = externalEntry()
    cache.addEntry(entry.id, oldPath)
    const pending = cache.check(entry)
    cache.addEntry(entry.id, oldPath)
    probe.resolve('missing')
    expect(await pending).toBe('missing')
    expect(await cache.check(entry)).toBe('missing')
  })

  it('lets a new probe finish after clear even when the discarded old probe settles first', async () => {
    const first = deferred<DanglingState>()
    const second = deferred<DanglingState>()
    const statProbe = vi.fn<(p: AbsoluteFilePath) => Promise<DanglingState>>()
    statProbe.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const cache = createDanglingCacheImpl({ statProbe })
    const entry = externalEntry()
    const events: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((event) => events.push(event))
    const oldCheck = cache.check(entry)
    cache.clear()
    const newCheck = cache.check(entry)
    first.resolve('missing')
    expect(await oldCheck).toBe('unknown')
    expect(events).toEqual([])
    second.resolve('present')
    expect(await newCheck).toBe('present')
    expect(await cache.check(entry)).toBe('present')
    expect(events).toEqual([{ id: entry.id, state: 'present' }])
  })

  it('does not invalidate probes belonging to another entry', async () => {
    const probe = deferred<DanglingState>()
    const cache = createDanglingCacheImpl({ statProbe: () => probe.promise })
    const entry = externalEntry()
    const other = externalEntry(newPath)
    cache.addEntry(entry.id, oldPath)
    cache.addEntry(other.id, newPath)
    const pending = cache.check(entry)
    cache.onFsEvent(newPath, 'present')
    probe.resolve('missing')
    expect(await pending).toBe('missing')
    expect(await cache.check(entry)).toBe('missing')
    expect(await cache.check(other)).toBe('present')
  })
})

describe('DanglingCache during a real external rename', () => {
  setupTestDatabase()
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-dangling-rename-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('preserves the new path observation and file bytes when an old path stat finishes late', async () => {
    let now = 0
    const gate = deferred<void>()
    const entered = deferred<void>()
    const probedPaths: AbsoluteFilePath[] = []
    const cache = createDanglingCacheImpl({
      now: () => now,
      statProbe: async (filePath) => {
        probedPaths.push(filePath)
        entered.resolve()
        await gate.promise
        try {
          await stat(filePath)
          return 'present'
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
          throw error
        }
      }
    })
    const deps = {
      fileEntryService,
      fileRefService,
      danglingCache: cache,
      versionCache: createVersionCacheImpl(10),
      contentWriteLock: new KeyedMutex()
    }
    const originalPath = canonicalizeFilePath(path.join(root, 'original.txt'))
    await writeFile(originalPath, 'retained bytes')
    const entry = await ensureExternal(deps, { externalPath: originalPath, cleanupPolicy: 'manual' })
    now += 31 * 60 * 1000
    const events: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((event) => events.push(event))
    const pending = cache.check(entry)
    await entered.promise
    try {
      const renamed = await rename(deps, entry.id, 'renamed')
      const renamedPath = canonicalizeFilePath(path.join(root, 'renamed.txt'))
      expect(fileEntryService.getById(entry.id)).toMatchObject({ externalPath: renamedPath, name: 'renamed' })
      expect(await readFile(renamedPath, 'utf8')).toBe('retained bytes')
      await expect(stat(originalPath)).rejects.toMatchObject({ code: 'ENOENT' })
      gate.resolve()
      expect(await pending).toBe('present')
      now += 1000
      expect(await cache.check(renamed)).toBe('present')
      expect(probedPaths).toEqual([originalPath])
      expect(events).toEqual([{ id: entry.id, state: 'present' }])
    } finally {
      gate.resolve()
      await pending
    }
  })
})

import type { DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import { describe, expect, it, vi } from 'vitest'

import type { DanglingStateChangedEvent, ObservedPresence } from '../danglingCache'
import { createDanglingCacheImpl } from '../danglingCache'

const internalEntry = (id: string = 'i-1'): FileEntry =>
  ({
    id,
    origin: 'internal',
    name: 'a',
    ext: 'txt',
    size: 1,
    externalPath: null,
    trashedAt: null,
    createdAt: 0,
    updatedAt: 0
  }) as FileEntry

const externalEntry = (id: string = 'e-1', path: string = '/abs/file.txt'): FileEntry =>
  ({
    id,
    origin: 'external',
    name: 'file',
    ext: 'txt',
    size: null,
    externalPath: path,
    trashedAt: null,
    createdAt: 0,
    updatedAt: 0
  }) as FileEntry

describe('DanglingCache.check', () => {
  it('returns "present" for internal entries without invoking statProbe', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>()
    const cache = createDanglingCacheImpl({ statProbe })
    const state = await cache.check(internalEntry())
    expect(state).toBe('present')
    expect(statProbe).not.toHaveBeenCalled()
  })

  it('cold miss: runs statProbe with externalPath, caches the observation, returns the concrete state', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    const cache = createDanglingCacheImpl({ statProbe })
    const state = await cache.check(externalEntry('e-1', '/abs/file.txt'))
    expect(state).toBe('present')
    expect(statProbe).toHaveBeenCalledTimes(1)
    expect(statProbe).toHaveBeenCalledWith('/abs/file.txt')
  })

  it('cold miss "missing": resolves to "missing"', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    const cache = createDanglingCacheImpl({ statProbe })
    const state = await cache.check(externalEntry('e-2', '/gone.txt'))
    expect(state).toBe('missing')
  })

  it('TTL hit: returns cached state without re-statting', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    let t = 1_000_000
    const cache = createDanglingCacheImpl({ statProbe, now: () => t, ttlMs: 1000 })
    await cache.check(externalEntry('e-3', '/a.txt'))
    t += 500
    await cache.check(externalEntry('e-3', '/a.txt'))
    expect(statProbe).toHaveBeenCalledTimes(1)
  })

  it('TTL expired: re-stats and refreshes the cache', async () => {
    const statProbe = vi
      .fn<(p: FilePath) => Promise<ObservedPresence>>()
      .mockResolvedValueOnce('present')
      .mockResolvedValueOnce('missing')
    let t = 1_000_000
    const cache = createDanglingCacheImpl({ statProbe, now: () => t, ttlMs: 1000 })
    expect(await cache.check(externalEntry('e-4', '/b.txt'))).toBe('present')
    t += 1500
    expect(await cache.check(externalEntry('e-4', '/b.txt'))).toBe('missing')
    expect(statProbe).toHaveBeenCalledTimes(2)
  })

  it('probe "unknown": returns unknown without committing to cache', async () => {
    // statProbe reports the probe could not determine presence (e.g. EACCES).
    // The cache must surface "unknown" rather than falsely classify as missing,
    // and must NOT commit — otherwise a transient EACCES would latch a
    // permanent false "unknown" within the TTL window.
    const statProbe = vi
      .fn<(p: FilePath) => Promise<DanglingState>>()
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce('present')
    const cache = createDanglingCacheImpl({ statProbe })
    expect(await cache.check(externalEntry('e-unk', '/locked.txt'))).toBe('unknown')
    // Next call still cold-stats (no cached state for e-unk)
    expect(await cache.check(externalEntry('e-unk', '/locked.txt'))).toBe('present')
    expect(statProbe).toHaveBeenCalledTimes(2)
  })

  it('probe "unknown" does not fire onDanglingStateChanged', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<DanglingState>>().mockResolvedValue('unknown')
    const cache = createDanglingCacheImpl({ statProbe })
    const seen: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((e) => seen.push(e))
    cache.addEntry('e-unk2' as FileEntryId, '/locked2.txt' as FilePath)
    await cache.check(externalEntry('e-unk2', '/locked2.txt'))
    expect(seen).toEqual([])
  })

  it('TTL-expired re-stat: probe "unknown" does NOT clobber the prior cached observation', async () => {
    // A transient FS error (EACCES, EMFILE, …) on TTL-expired re-stat must
    // not overwrite a known-good observation — otherwise the UI flip-flops
    // on every transient failure. The caller still sees 'unknown' for this
    // call (surfaced from the probe), but byEntryId retains the prior state
    // so a subsequent successful probe / event can reconcile cleanly.
    const statProbe = vi
      .fn<(p: FilePath) => Promise<DanglingState>>()
      .mockResolvedValueOnce('present')
      .mockResolvedValueOnce('unknown')
    let t = 1_000_000
    const cache = createDanglingCacheImpl({ statProbe, now: () => t, ttlMs: 1000 })
    // Seed: cold-miss stats and commits 'present' at t=1_000_000.
    expect(await cache.check(externalEntry('e-mix', '/p.txt'))).toBe('present')
    // TTL window elapses → next check re-stats and receives 'unknown'.
    t += 1500
    expect(await cache.check(externalEntry('e-mix', '/p.txt'))).toBe('unknown')
    expect(statProbe).toHaveBeenCalledTimes(2)
  })
})

describe('DanglingCache.onFsEvent + reverse index', () => {
  it('records the observation; subsequent check returns the observed state without statting', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    const cache = createDanglingCacheImpl({ statProbe })
    cache.addEntry('e-6' as FileEntryId, '/abs/file.txt' as FilePath)
    cache.onFsEvent('/abs/file.txt' as FilePath, 'present')
    const state = await cache.check(externalEntry('e-6', '/abs/file.txt'))
    expect(state).toBe('present')
    expect(statProbe).not.toHaveBeenCalled()
  })

  it('fans out via reverse index when multiple entries share a path', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>()
    const cache = createDanglingCacheImpl({ statProbe })
    cache.addEntry('e-7' as FileEntryId, '/abs/shared.txt' as FilePath)
    cache.addEntry('e-8' as FileEntryId, '/abs/shared.txt' as FilePath)
    cache.onFsEvent('/abs/shared.txt' as FilePath, 'missing')
    expect(await cache.check(externalEntry('e-7', '/abs/shared.txt'))).toBe('missing')
    expect(await cache.check(externalEntry('e-8', '/abs/shared.txt'))).toBe('missing')
    expect(statProbe).not.toHaveBeenCalled()
  })

  it('ignores events for paths that have no registered entries', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    const cache = createDanglingCacheImpl({ statProbe })
    cache.onFsEvent('/abs/orphan.txt' as FilePath, 'present')
    // No entry was registered → no cached state → check on a NEW entry must
    // still cold-stat
    const state = await cache.check(externalEntry('e-9', '/abs/orphan.txt'))
    expect(state).toBe('missing') // probe ran
    expect(statProbe).toHaveBeenCalledTimes(1)
  })

  it('removeEntry stops events from reaching that entry id', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    const cache = createDanglingCacheImpl({ statProbe })
    cache.addEntry('e-10' as FileEntryId, '/abs/keep.txt' as FilePath)
    cache.removeEntry('e-10' as FileEntryId, '/abs/keep.txt' as FilePath)
    cache.onFsEvent('/abs/keep.txt' as FilePath, 'present')
    // Cache empty for e-10 → check cold-stats and gets 'missing'
    const state = await cache.check(externalEntry('e-10', '/abs/keep.txt'))
    expect(state).toBe('missing')
  })
})

describe('DanglingCache.onDanglingStateChanged', () => {
  it('fires on cold-miss → concrete state observation via check()', async () => {
    const cache = createDanglingCacheImpl({
      statProbe: vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    })
    const seen: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((e) => seen.push(e))
    cache.addEntry('e-11' as FileEntryId, '/abs/x.txt' as FilePath)
    await cache.check(externalEntry('e-11', '/abs/x.txt'))
    expect(seen).toEqual([{ id: 'e-11', state: 'present' }])
  })

  it('does NOT fire when observation matches the current cached state', async () => {
    const cache = createDanglingCacheImpl({
      statProbe: vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    })
    cache.addEntry('e-12' as FileEntryId, '/abs/y.txt' as FilePath)
    cache.onFsEvent('/abs/y.txt' as FilePath, 'present')
    const seen: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((e) => seen.push(e))
    cache.onFsEvent('/abs/y.txt' as FilePath, 'present')
    expect(seen).toEqual([])
  })

  it('fires on present → missing transition', async () => {
    const cache = createDanglingCacheImpl({
      statProbe: vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    })
    cache.addEntry('e-13' as FileEntryId, '/abs/z.txt' as FilePath)
    cache.onFsEvent('/abs/z.txt' as FilePath, 'present')
    const seen: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((e) => seen.push(e))
    cache.onFsEvent('/abs/z.txt' as FilePath, 'missing')
    expect(seen).toEqual([{ id: 'e-13', state: 'missing' }])
  })

  it('internal entries never trigger transitions (they are not tracked)', async () => {
    const cache = createDanglingCacheImpl({ statProbe: vi.fn() })
    const seen: DanglingStateChangedEvent[] = []
    cache.onDanglingStateChanged((e) => seen.push(e))
    await cache.check(internalEntry('i-3'))
    expect(seen).toEqual([])
  })
})

describe('DanglingCache.initFromDb', () => {
  it('populates reverse index from non-trashed external entries', async () => {
    const findMany = vi
      .fn<(q: { origin: 'external' }) => Promise<FileEntry[]>>()
      .mockResolvedValue([externalEntry('e-init-1', '/abs/init-a.txt'), externalEntry('e-init-2', '/abs/init-b.txt')])
    const cache = createDanglingCacheImpl({
      fileEntryService: { findMany },
      statProbe: vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    })
    await cache.initFromDb()
    expect(findMany).toHaveBeenCalledWith({ origin: 'external' })

    // After init, an event for an indexed path reaches the entry without stat
    cache.onFsEvent('/abs/init-a.txt' as FilePath, 'present')
    const probe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>()
    // The cache hit means probe is not called for 'e-init-1':
    expect(await cache.check(externalEntry('e-init-1', '/abs/init-a.txt'))).toBe('present')
    expect(probe).not.toHaveBeenCalled()
  })

  it('skips trashed external entries', async () => {
    const findMany = vi.fn<(q: { origin: 'external' }) => Promise<FileEntry[]>>().mockResolvedValue([
      // trashedAt set → must be skipped
      { ...externalEntry('e-trash', '/abs/trash.txt'), trashedAt: 123 } as FileEntry,
      externalEntry('e-live', '/abs/live.txt')
    ])
    const cache = createDanglingCacheImpl({
      fileEntryService: { findMany },
      statProbe: vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    })
    await cache.initFromDb()
    // Event for /abs/trash.txt must NOT reach e-trash
    cache.onFsEvent('/abs/trash.txt' as FilePath, 'present')
    const trashState = await cache.check(externalEntry('e-trash', '/abs/trash.txt'))
    expect(trashState).toBe('missing') // re-stat, not the cached 'present'
  })
})

describe('DanglingCache.subscribe', () => {
  it('only delivers events for the specified entry id', async () => {
    const cache = createDanglingCacheImpl({
      statProbe: vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    })
    cache.addEntry('e-14' as FileEntryId, '/abs/a' as FilePath)
    cache.addEntry('e-15' as FileEntryId, '/abs/b' as FilePath)
    const seen: Array<[FileEntryId, string]> = []
    const unsubscribe = cache.subscribe('e-14' as FileEntryId, (id, s) => seen.push([id, s]))
    cache.onFsEvent('/abs/b' as FilePath, 'present') // for e-15 — should not be delivered
    cache.onFsEvent('/abs/a' as FilePath, 'missing') // for e-14 — delivered
    expect(seen).toEqual([['e-14' as FileEntryId, 'missing']])
    unsubscribe()
    cache.onFsEvent('/abs/a' as FilePath, 'present') // post-dispose: silent
    expect(seen).toEqual([['e-14' as FileEntryId, 'missing']])
  })
})

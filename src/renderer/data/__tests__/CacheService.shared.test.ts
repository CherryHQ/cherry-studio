/**
 * Tests for renderer-side shared-tier sync semantics (issue #17050).
 *
 * Covers:
 *  - getSharedSnapshot: pure physical read for external-store snapshots — no
 *    TTL evaluation, no lazy eviction, no notification, no broadcast; repeated
 *    calls return the identical result until the store actually changes.
 *  - inbound sync gating (fix A3): an equal-value message (Main's TTL-only
 *    refresh) renews expireAt in place, keeps the old value reference, and does
 *    NOT notify subscribers; value changes and deletion tombstones do notify.
 *    Equality is judged against the raw physical entry, never TTL-aware.
 */
import type { CacheSyncBatchMessage, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from renderer.setup.ts — we want the REAL CacheService
vi.unmock('@data/CacheService')

const broadcastSync = vi.fn()
const onSync = vi.fn()
const onSyncBatch = vi.fn()
const getAllShared = vi.fn(async () => ({}))

const BASE = 1_000_000

// JobManager's live progress key — the standing consumer of TTL'd entries.
const KEY = 'jobs.progress.job-1' as const

let now: number

beforeEach(() => {
  broadcastSync.mockClear()
  onSync.mockClear()
  onSyncBatch.mockClear()
  getAllShared.mockClear()

  now = BASE
  vi.spyOn(Date, 'now').mockImplementation(() => now)

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync,
        onSync,
        onSyncBatch,
        getAllShared
      }
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function createService() {
  const { CacheService } = await import('../CacheService')
  const service = new CacheService()
  const inbound = onSync.mock.calls.at(-1)![0] as (message: CacheSyncMessage) => void
  const inboundBatch = onSyncBatch.mock.calls.at(-1)![0] as (message: CacheSyncBatchMessage) => void
  return { service, inbound, inboundBatch }
}

describe('getSharedSnapshot (pure physical read)', () => {
  it('returns undefined for a physically absent key', async () => {
    const { service } = await createService()
    expect(service.getSharedSnapshot(KEY)).toBeUndefined()
  })

  it('ignores expiry: keeps returning the same reference after the TTL lapses', async () => {
    const { service } = await createService()
    service.setShared(KEY, { progress: 40 }, 1_000)
    const snapshot = service.getSharedSnapshot(KEY)
    expect(snapshot).toEqual({ progress: 40 })

    now = BASE + 5_000 // entry expired, not yet collected

    // Same result, same reference — an external-store snapshot must not flip
    // with time when no change event fired.
    expect(service.getSharedSnapshot(KEY)).toBe(snapshot)
  })

  it('never mutates the store, notifies, or broadcasts — even on an expired entry', async () => {
    const { service } = await createService()
    service.setShared(KEY, { progress: 40 }, 1_000)
    now = BASE + 5_000
    const sub = vi.fn()
    service.subscribe(KEY, sub)
    broadcastSync.mockClear()

    service.getSharedSnapshot(KEY)

    expect(sub).not.toHaveBeenCalled()
    expect(broadcastSync).not.toHaveBeenCalled()
    expect(service.getSharedSnapshot(KEY)).toEqual({ progress: 40 }) // still physically present
  })

  it('goes undefined once the imperative getShared lazily evicts the expired entry', async () => {
    const { service } = await createService()
    service.setShared(KEY, { progress: 40 }, 1_000)
    now = BASE + 5_000
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    expect(service.getShared(KEY)).toBeUndefined() // TTL-aware read evicts + notifies
    expect(sub).toHaveBeenCalledTimes(1)
    expect(service.getSharedSnapshot(KEY)).toBeUndefined()
  })
})

describe('inbound sync gating (fix A3)', () => {
  it('applies a batch and notifies each changed key', async () => {
    const { service, inboundBatch } = await createService()
    const secondKey = 'jobs.progress.job-2' as const
    const firstSub = vi.fn()
    const secondSub = vi.fn()
    service.subscribe(
      KEY,
      vi.fn(() => {
        firstSub(service.getSharedSnapshot(secondKey))
      })
    )
    service.subscribe(secondKey, secondSub)

    inboundBatch({
      type: 'shared',
      entries: [
        { key: KEY, value: { progress: 25 }, expireAt: BASE + 60_000 },
        { key: secondKey, value: { progress: 50 }, expireAt: BASE + 60_000 }
      ]
    })

    expect(service.getSharedSnapshot(KEY)).toEqual({ progress: 25 })
    expect(service.getSharedSnapshot(secondKey)).toEqual({ progress: 50 })
    expect(firstSub).toHaveBeenCalledWith({ progress: 50 })
    expect(secondSub).toHaveBeenCalledTimes(1)
  })

  it('applies batch tombstones after all entries have been updated', async () => {
    const { service, inbound, inboundBatch } = await createService()
    const secondKey = 'jobs.progress.job-2' as const
    inbound({ type: 'shared', key: KEY, value: { progress: 100 } })
    inbound({ type: 'shared', key: secondKey, value: { progress: 100 } })
    const firstSub = vi.fn(() => service.getSharedSnapshot(secondKey))
    const secondSub = vi.fn()
    service.subscribe(KEY, firstSub)
    service.subscribe(secondKey, secondSub)

    inboundBatch({
      type: 'shared',
      entries: [
        { key: KEY, value: undefined },
        { key: secondKey, value: undefined }
      ]
    })

    expect(firstSub).toHaveReturnedWith(undefined)
    expect(secondSub).toHaveBeenCalledTimes(1)
    expect(service.getSharedSnapshot(KEY)).toBeUndefined()
    expect(service.getSharedSnapshot(secondKey)).toBeUndefined()
  })

  it('renews equal-value TTL entries in a batch without notifying', async () => {
    const { service, inbound, inboundBatch } = await createService()
    inbound({ type: 'shared', key: KEY, value: { progress: 50 }, expireAt: BASE + 1_000 })
    const snapshot = service.getSharedSnapshot(KEY)
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    inboundBatch({
      type: 'shared',
      entries: [{ key: KEY, value: { progress: 50 }, expireAt: BASE + 60_000 }]
    })

    expect(sub).not.toHaveBeenCalled()
    expect(service.getSharedSnapshot(KEY)).toBe(snapshot)
  })

  it('deletion tombstone physically deletes and always notifies', async () => {
    const { service, inbound } = await createService()
    inbound({ type: 'shared', key: KEY, value: { progress: 100 } })
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    inbound({ type: 'shared', key: KEY, value: undefined })

    expect(sub).toHaveBeenCalledTimes(1)
    expect(service.getSharedSnapshot(KEY)).toBeUndefined()
  })

  it('equal-value TTL-only message renews expireAt in place without notifying (reference preserved)', async () => {
    const { service, inbound } = await createService()
    inbound({ type: 'shared', key: KEY, value: { progress: 50 }, expireAt: BASE + 1_000 })
    const snapshot = service.getSharedSnapshot(KEY)
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    // Main's heartbeat: deep-equal value (new object through IPC), renewed TTL.
    inbound({ type: 'shared', key: KEY, value: { progress: 50 }, expireAt: BASE + 60_000 })

    expect(sub).not.toHaveBeenCalled()
    expect(service.getSharedSnapshot(KEY)).toBe(snapshot) // old reference kept

    // The renewal is real: past the OLD expiry the entry is still live.
    now = BASE + 30_000
    expect(service.getShared(KEY)).toEqual({ progress: 50 })
  })

  it('judges equality against the raw physical entry, never TTL-aware', async () => {
    const { service, inbound } = await createService()
    inbound({ type: 'shared', key: KEY, value: { progress: 50 }, expireAt: BASE + 1_000 })
    now = BASE + 5_000 // locally expired but physically retained
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    inbound({ type: 'shared', key: KEY, value: { progress: 50 }, expireAt: now + 60_000 })

    // The observer's snapshot value never changed (physical read kept returning
    // the old value), so silence is correct; treating the expired entry as
    // "absent" here would notify with no observable change.
    expect(sub).not.toHaveBeenCalled()
    expect(service.getShared(KEY)).toEqual({ progress: 50 }) // entry revived
  })

  it('value change replaces the entry and notifies', async () => {
    const { service, inbound } = await createService()
    inbound({ type: 'shared', key: KEY, value: { progress: 50 } })
    const before = service.getSharedSnapshot(KEY)
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    inbound({ type: 'shared', key: KEY, value: { progress: 75 } })

    expect(sub).toHaveBeenCalledTimes(1)
    expect(service.getSharedSnapshot(KEY)).toEqual({ progress: 75 })
    expect(service.getSharedSnapshot(KEY)).not.toBe(before)
  })

  it('a set on a physically absent key notifies (value appears)', async () => {
    const { service, inbound } = await createService()
    const sub = vi.fn()
    service.subscribe(KEY, sub)

    inbound({ type: 'shared', key: KEY, value: { progress: 10 }, expireAt: BASE + 60_000 })

    expect(sub).toHaveBeenCalledTimes(1)
    expect(service.getSharedSnapshot(KEY)).toEqual({ progress: 10 })
  })

  it('JobManager scenario: a Main tombstone clears the mirror of a window that never read the key', async () => {
    const { service, inbound } = await createService()
    // Progress entries stream in while the job runs; this window never calls
    // getShared, so only the tombstone can clean its mirror up.
    inbound({ type: 'shared', key: KEY, value: { progress: 99 }, expireAt: BASE + 60_000 })
    expect(service.getSharedSnapshot(KEY)).toEqual({ progress: 99 })

    now = BASE + 120_000 // TTL long past; Main's GC sweep broadcasts the tombstone
    inbound({ type: 'shared', key: KEY, value: undefined })

    expect(service.getSharedSnapshot(KEY)).toBeUndefined()
  })
})

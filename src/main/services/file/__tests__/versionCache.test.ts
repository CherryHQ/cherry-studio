import type { FileEntryId } from '@shared/data/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { FileVersion } from '../FileManager'
import { createVersionCacheImpl, versionCache } from '../versionCache'

const mkVersion = (mtime: number, size: number): FileVersion => ({ mtime, size })
const mkId = (n: number): FileEntryId => `019606a0-0000-7000-8000-${n.toString().padStart(12, '0')}`

describe('versionCache (default singleton)', () => {
  beforeEach(() => versionCache.clear())
  afterEach(() => versionCache.clear())

  it('round-trips set/get', () => {
    const id = mkId(1)
    versionCache.set(id, mkVersion(100, 10))
    expect(versionCache.get(id)).toEqual({ mtime: 100, size: 10 })
  })

  it('overwrites existing entries', () => {
    const id = mkId(2)
    versionCache.set(id, mkVersion(100, 10))
    versionCache.set(id, mkVersion(200, 20))
    expect(versionCache.get(id)).toEqual({ mtime: 200, size: 20 })
  })

  it('invalidates a single key', () => {
    const id = mkId(3)
    versionCache.set(id, mkVersion(1, 1))
    versionCache.invalidate(id)
    expect(versionCache.get(id)).toBeUndefined()
  })

  it('clear empties everything', () => {
    versionCache.set(mkId(4), mkVersion(1, 1))
    versionCache.set(mkId(5), mkVersion(2, 2))
    versionCache.clear()
    expect(versionCache.get(mkId(4))).toBeUndefined()
    expect(versionCache.get(mkId(5))).toBeUndefined()
  })
})

describe('versionCache LRU bound', () => {
  it('evicts the least-recently-used entry when capacity is exceeded', () => {
    const cache = createVersionCacheImpl(2)
    const a = mkId(10)
    const b = mkId(11)
    const c = mkId(12)
    cache.set(a, mkVersion(1, 1))
    cache.set(b, mkVersion(2, 2))
    // capacity 2 — adding c must evict the LRU (a, since b is more recent)
    cache.set(c, mkVersion(3, 3))
    expect(cache.get(a)).toBeUndefined()
    expect(cache.get(b)).toEqual({ mtime: 2, size: 2 })
    expect(cache.get(c)).toEqual({ mtime: 3, size: 3 })
  })

  it('refreshes recency on get so the touched entry survives eviction', () => {
    const cache = createVersionCacheImpl(2)
    const a = mkId(20)
    const b = mkId(21)
    const c = mkId(22)
    cache.set(a, mkVersion(1, 1))
    cache.set(b, mkVersion(2, 2))
    // touch a — now b is the LRU
    expect(cache.get(a)).toEqual({ mtime: 1, size: 1 })
    cache.set(c, mkVersion(3, 3))
    expect(cache.get(b)).toBeUndefined()
    expect(cache.get(a)).toEqual({ mtime: 1, size: 1 })
    expect(cache.get(c)).toEqual({ mtime: 3, size: 3 })
  })
})

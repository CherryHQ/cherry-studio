import type { FileEntryId } from '@shared/data/types/file'
import { beforeEach, describe, expect, it } from 'vitest'

import type { FileVersion } from '../FileManager'
import { createVersionCacheImpl, type VersionCache } from '../versionCache'

const mkVersion = (mtime: number, size: number): FileVersion => ({ mtime, size })
const mkId = (n: number): FileEntryId => `019606a0-0000-7000-8000-${n.toString().padStart(12, '0')}`

describe('versionCache CRUD', () => {
  let cache: VersionCache
  beforeEach(() => {
    cache = createVersionCacheImpl(2000)
  })

  it('round-trips set/get', () => {
    const id = mkId(1)
    cache.set(id, mkVersion(100, 10))
    expect(cache.get(id)).toEqual({ mtime: 100, size: 10 })
  })

  it('overwrites existing entries', () => {
    const id = mkId(2)
    cache.set(id, mkVersion(100, 10))
    cache.set(id, mkVersion(200, 20))
    expect(cache.get(id)).toEqual({ mtime: 200, size: 20 })
  })

  it('invalidates a single key', () => {
    const id = mkId(3)
    cache.set(id, mkVersion(1, 1))
    cache.invalidate(id)
    expect(cache.get(id)).toBeUndefined()
  })

  it('clear empties everything', () => {
    cache.set(mkId(4), mkVersion(1, 1))
    cache.set(mkId(5), mkVersion(2, 2))
    cache.clear()
    expect(cache.get(mkId(4))).toBeUndefined()
    expect(cache.get(mkId(5))).toBeUndefined()
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

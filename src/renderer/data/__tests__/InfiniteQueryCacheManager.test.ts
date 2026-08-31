import type { Cache } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InfiniteQueryCacheManager } from '../InfiniteQueryCacheManager'

const RELEASE_DELAY_MS = 1_000
const IDLE_TTL_MS = 10 * 60_000
const RETENTION_OPTIONS = {
  idleTtlMs: IDLE_TTL_MS,
  maxInactiveGroups: 4,
  maxInactivePages: 12,
  releaseDelayMs: RELEASE_DELAY_MS
} as const

type TestCache = Cache & Pick<Map<string, unknown>, 'has'>

function createCache(): TestCache {
  return new Map<string, unknown>() as unknown as TestCache
}

function createManager(): InfiniteQueryCacheManager {
  return new InfiniteQueryCacheManager(RETENTION_OPTIONS, globalThis.Date)
}

function seedGroup(manager: InfiniteQueryCacheManager, cache: TestCache, id: string, pageCount: number) {
  const groupKey = `$inf$${id}`
  const pageKeys = Array.from({ length: pageCount }, (_, index) => `${id}:page:${index}`)
  cache.set(groupKey, { data: [] })
  const release = manager.acquire(cache, groupKey)

  for (const pageKey of pageKeys) {
    cache.set(pageKey, { data: { items: [] } })
  }
  manager.syncPages(cache, groupKey, pageKeys)

  return { groupKey, pageKeys, release }
}

async function enterInactive() {
  await vi.advanceTimersByTimeAsync(RELEASE_DELAY_MS)
  await flushScheduledEviction()
}

async function flushScheduledEviction() {
  await vi.advanceTimersByTimeAsync(1)
}

describe('InfiniteQueryCacheManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a pending eviction from deleting a group acquired again', async () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 13)
    const finishRequest = manager.beginRequest(cache, group.groupKey, group.pageKeys[0])

    group.release()
    await enterInactive()
    expect(cache.has(group.groupKey)).toBe(true)

    manager.acquire(cache, group.groupKey)
    finishRequest()
    await flushScheduledEviction()

    expect(cache.has(group.groupKey)).toBe(true)
    expect(group.pageKeys.every((pageKey) => cache.has(pageKey))).toBe(true)
  })

  it('does not clear SWR entries when acquire removes a group from the inactive LRU', async () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 2)

    group.release()
    await enterInactive()
    manager.acquire(cache, group.groupKey)
    await vi.advanceTimersByTimeAsync(IDLE_TTL_MS + 1)

    expect(cache.has(group.groupKey)).toBe(true)
    expect(group.pageKeys.every((pageKey) => cache.has(pageKey))).toBe(true)
  })

  it('removes cursor pages replaced by the current page chain', async () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 2)
    const firstPageKey = group.pageKeys[0]
    let previousCursorPageKey = group.pageKeys[1]

    for (let index = 0; index < 12; index += 1) {
      const nextCursorPageKey = `conversation:cursor:${index}`
      cache.set(nextCursorPageKey, { data: { items: [] } })
      manager.syncPages(cache, group.groupKey, [firstPageKey, nextCursorPageKey])

      expect(cache.has(previousCursorPageKey)).toBe(false)
      previousCursorPageKey = nextCursorPageKey
    }

    group.release()
    await enterInactive()

    expect(cache.has(group.groupKey)).toBe(true)
    expect(cache.has(firstPageKey)).toBe(true)
    expect(cache.has(previousCursorPageKey)).toBe(true)
  })

  it('waits for a replaced page request and the next page-chain sync before deleting it', () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 2)
    const [firstPageKey, oldCursorPageKey] = group.pageKeys
    const finishRequest = manager.beginRequest(cache, group.groupKey, oldCursorPageKey)
    const nextCursorPageKey = 'conversation:cursor:next'
    cache.set(nextCursorPageKey, { data: { items: [] } })

    manager.syncPages(cache, group.groupKey, [firstPageKey, nextCursorPageKey])
    expect(cache.has(oldCursorPageKey)).toBe(true)

    finishRequest()
    expect(cache.has(oldCursorPageKey)).toBe(true)

    manager.syncPages(cache, group.groupKey, [firstPageKey, nextCursorPageKey])
    expect(cache.has(oldCursorPageKey)).toBe(false)
    expect(cache.has(nextCursorPageKey)).toBe(true)
  })

  it('removes a failed request key that never joined the page chain', () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 1)
    const failedPageKey = 'conversation:cursor:failed'
    cache.set(failedPageKey, { data: { items: [] } })

    const finishRequest = manager.beginRequest(cache, group.groupKey, failedPageKey)
    finishRequest(false)

    expect(cache.has(failedPageKey)).toBe(false)
    expect(cache.has(group.pageKeys[0])).toBe(true)
  })

  it('keeps a group active until its final subscriber releases it', async () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 13)
    const releaseSecondSubscriber = manager.acquire(cache, group.groupKey)

    group.release()
    await enterInactive()
    expect(cache.has(group.groupKey)).toBe(true)

    releaseSecondSubscriber()
    await enterInactive()
    expect(cache.has(group.groupKey)).toBe(false)
  })

  it('actively expires an inactive group without another cache access', async () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 2)

    group.release()
    await enterInactive()
    await vi.advanceTimersByTimeAsync(IDLE_TTL_MS + 1)
    await flushScheduledEviction()

    expect(cache.has(group.groupKey)).toBe(false)
    expect(group.pageKeys.every((pageKey) => !cache.has(pageKey))).toBe(true)
  })

  it('waits for an in-flight request and one macrotask before deleting the group', async () => {
    const manager = createManager()
    const cache = createCache()
    const group = seedGroup(manager, cache, 'conversation', 13)
    const finishRequest = manager.beginRequest(cache, group.groupKey, group.pageKeys[0])

    group.release()
    await enterInactive()
    expect(cache.has(group.groupKey)).toBe(true)

    finishRequest()
    expect(cache.has(group.groupKey)).toBe(true)
    await flushScheduledEviction()

    expect(cache.has(group.groupKey)).toBe(false)
    expect(group.pageKeys.every((pageKey) => !cache.has(pageKey))).toBe(true)
  })

  it('retains at most four inactive groups', async () => {
    const manager = createManager()
    const cache = createCache()
    const groups = Array.from({ length: 5 }, (_, index) => seedGroup(manager, cache, `group-${index}`, 1))

    for (const group of groups) group.release()
    await enterInactive()

    expect(cache.has(groups[0].groupKey)).toBe(false)
    expect(groups.slice(1).every((group) => cache.has(group.groupKey))).toBe(true)
  })

  it('retains at most twelve page keys across inactive groups', async () => {
    const manager = createManager()
    const cache = createCache()
    const groups = Array.from({ length: 3 }, (_, index) => seedGroup(manager, cache, `group-${index}`, 5))

    for (const group of groups) group.release()
    await enterInactive()

    expect(cache.has(groups[0].groupKey)).toBe(false)
    expect(groups.slice(1).every((group) => cache.has(group.groupKey))).toBe(true)
  })

  it('isolates identical group keys owned by different SWR providers', async () => {
    const manager = createManager()
    const firstCache = createCache()
    const secondCache = createCache()
    const firstGroup = seedGroup(manager, firstCache, 'conversation', 13)
    const secondGroup = seedGroup(manager, secondCache, 'conversation', 1)

    firstGroup.release()
    await enterInactive()

    expect(firstCache.has(firstGroup.groupKey)).toBe(false)
    expect(secondCache.has(secondGroup.groupKey)).toBe(true)
    expect(secondCache.has(secondGroup.pageKeys[0])).toBe(true)
  })
})

import { LRUCache } from 'lru-cache'
import type { Cache } from 'swr'

export interface InfiniteQueryRetentionOptions {
  idleTtlMs: number
  maxInactiveGroups: number
  maxInactivePages: number
  releaseDelayMs: number
}

interface RetentionClock {
  now(): number
}

interface CacheGroup {
  currentPageKeys: Set<string>
  evictionGeneration?: number
  evictionTimer?: ReturnType<typeof setTimeout>
  generation: number
  groupKey: string
  inFlight: number
  inFlightPageKeys: Map<string, { count: number; succeeded: boolean }>
  pageKeys: Set<string>
  releaseTimer?: ReturnType<typeof setTimeout>
  subscribers: number
}

interface ProviderState {
  cache: Cache
  groups: Map<string, CacheGroup>
  inactiveGroups: LRUCache<string, CacheGroup>
}

/** Coordinates bounded retention for inactive SWR infinite-query cache groups. */
export class InfiniteQueryCacheManager {
  private providers = new WeakMap<Cache, ProviderState>()

  constructor(
    private readonly options: InfiniteQueryRetentionOptions,
    private readonly clock?: RetentionClock
  ) {}

  acquire(cache: Cache, groupKey: string): () => void {
    const provider = this.getProvider(cache)
    const group = this.getGroup(provider, groupKey)

    group.generation += 1
    group.subscribers += 1
    this.clearTimer(group, 'releaseTimer')
    this.cancelEviction(group)
    provider.inactiveGroups.delete(groupKey)

    let isReleased = false
    return () => {
      if (isReleased) return
      isReleased = true
      this.release(provider, group)
    }
  }

  syncPages(cache: Cache, groupKey: string, pageKeys: readonly string[]): void {
    const provider = this.getProvider(cache)
    const group = this.getGroup(provider, groupKey)
    const nextPageKeys = new Set(pageKeys)

    for (const pageKey of group.pageKeys) {
      if (!nextPageKeys.has(pageKey) && !group.inFlightPageKeys.has(pageKey)) {
        this.deletePage(provider, group, pageKey)
      }
    }

    group.currentPageKeys = nextPageKeys
    for (const pageKey of nextPageKeys) {
      group.pageKeys.add(pageKey)
    }
    this.refreshInactiveGroup(provider, group)
  }

  beginRequest(cache: Cache, groupKey: string, pageKey: string): (succeeded?: boolean) => void {
    const provider = this.getProvider(cache)
    const group = this.getGroup(provider, groupKey)

    group.inFlight += 1
    const pageRequest = group.inFlightPageKeys.get(pageKey) ?? { count: 0, succeeded: false }
    pageRequest.count += 1
    group.inFlightPageKeys.set(pageKey, pageRequest)
    this.clearTimer(group, 'evictionTimer')
    if (!group.pageKeys.has(pageKey)) {
      group.pageKeys.add(pageKey)
      this.refreshInactiveGroup(provider, group)
    }

    let isFinished = false
    return (succeeded = true) => {
      if (isFinished) return
      isFinished = true
      group.inFlight -= 1

      pageRequest.count -= 1
      pageRequest.succeeded ||= succeeded
      if (pageRequest.count === 0) {
        group.inFlightPageKeys.delete(pageKey)
        if (!pageRequest.succeeded && !group.currentPageKeys.has(pageKey)) {
          this.deletePage(provider, group, pageKey)
          this.refreshInactiveGroup(provider, group)
        }
      }

      if (group.inFlight === 0 && group.evictionGeneration !== undefined) {
        this.scheduleEviction(provider, group, group.evictionGeneration)
      }
    }
  }

  private getProvider(cache: Cache): ProviderState {
    const existing = this.providers.get(cache)
    if (existing) return existing

    const inactiveGroups = new LRUCache<string, CacheGroup>({
      max: this.options.maxInactiveGroups,
      maxSize: this.options.maxInactivePages,
      perf: this.clock ?? globalThis.performance,
      sizeCalculation: (group) => Math.max(1, group.pageKeys.size),
      ttl: this.options.idleTtlMs,
      ttlAutopurge: true,
      dispose: (group, _groupKey, reason) => {
        const provider = this.providers.get(cache)
        if (provider && (reason === 'evict' || reason === 'expire')) {
          this.requestEviction(provider, group, group.generation)
        }
      }
    })
    const provider = { cache, groups: new Map<string, CacheGroup>(), inactiveGroups }
    this.providers.set(cache, provider)
    return provider
  }

  private getGroup(provider: ProviderState, groupKey: string): CacheGroup {
    const existing = provider.groups.get(groupKey)
    if (existing) return existing

    const group: CacheGroup = {
      currentPageKeys: new Set(),
      generation: 0,
      groupKey,
      inFlight: 0,
      inFlightPageKeys: new Map(),
      pageKeys: new Set(),
      subscribers: 0
    }
    provider.groups.set(groupKey, group)
    return group
  }

  private release(provider: ProviderState, group: CacheGroup): void {
    group.subscribers = Math.max(0, group.subscribers - 1)
    if (group.subscribers > 0) return

    const generation = group.generation
    this.clearTimer(group, 'releaseTimer')
    group.releaseTimer = setTimeout(() => {
      group.releaseTimer = undefined
      if (group.subscribers > 0 || group.generation !== generation) return
      this.addInactiveGroup(provider, group, generation)
    }, this.options.releaseDelayMs)
  }

  private addInactiveGroup(provider: ProviderState, group: CacheGroup, generation: number): void {
    if (group.pageKeys.size > this.options.maxInactivePages) {
      this.requestEviction(provider, group, generation)
      return
    }

    provider.inactiveGroups.set(group.groupKey, group)
  }

  private refreshInactiveGroup(provider: ProviderState, group: CacheGroup): void {
    if (group.subscribers > 0 || group.evictionGeneration !== undefined) return
    if (!provider.inactiveGroups.delete(group.groupKey)) return

    this.addInactiveGroup(provider, group, group.generation)
  }

  private requestEviction(provider: ProviderState, group: CacheGroup, generation: number): void {
    if (group.subscribers > 0 || group.generation !== generation) return

    group.evictionGeneration = generation
    if (group.inFlight === 0) {
      this.scheduleEviction(provider, group, generation)
    }
  }

  private scheduleEviction(provider: ProviderState, group: CacheGroup, generation: number): void {
    this.clearTimer(group, 'evictionTimer')
    group.evictionTimer = setTimeout(() => {
      group.evictionTimer = undefined
      if (
        group.subscribers > 0 ||
        group.inFlight > 0 ||
        group.generation !== generation ||
        group.evictionGeneration !== generation
      ) {
        return
      }

      for (const pageKey of group.pageKeys) {
        provider.cache.delete(pageKey)
      }
      provider.cache.delete(group.groupKey)
      provider.groups.delete(group.groupKey)
    }, 0)
  }

  private cancelEviction(group: CacheGroup): void {
    group.evictionGeneration = undefined
    this.clearTimer(group, 'evictionTimer')
  }

  private deletePage(provider: ProviderState, group: CacheGroup, pageKey: string): void {
    provider.cache.delete(pageKey)
    group.pageKeys.delete(pageKey)
  }

  private clearTimer(group: CacheGroup, timer: 'releaseTimer' | 'evictionTimer'): void {
    const handle = group[timer]
    if (handle === undefined) return
    clearTimeout(handle)
    group[timer] = undefined
  }
}

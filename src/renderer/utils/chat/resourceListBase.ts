import dayjs from 'dayjs'

export type ResourceListGroup = {
  id: string
  label: string
  count?: number
}

export type ResourceListTimeBucket = 'today' | 'yesterday' | 'this-week' | 'earlier'

export type ResourceListGroupResolver<T> = (item: T) => ResourceListGroup | null

export type ResourceListItemReorderPayload = {
  type: 'item'
  activeId: string
  overId: string
  position: 'before' | 'after'
  overType: 'group' | 'item'
  sourceGroupId: string
  targetGroupId: string
  sourceIndex: number
  targetIndex: number
}

export type ResourceListGroupReorderPayload = {
  type: 'group'
  activeGroupId: string
  overGroupId: string
  overType: 'group' | 'item'
  sourceIndex: number
  targetIndex: number
}

type TimestampInput = dayjs.ConfigType
type GroupRankResolver<T> = (item: T) => number

/**
 * Resolves time buckets against boundaries derived once from `now`.
 *
 * Bucketing runs once per item in both the grouping resolver and the sort rank, so deriving the
 * day/week boundaries inside the per-item call allocates five dayjs objects per item for an answer
 * that is identical across the whole list. Callers that bucket a list should create one resolver
 * and reuse it; {@link getResourceTimeBucket} stays available for one-off lookups.
 */
export function createResourceTimeBucketResolver(
  now?: TimestampInput
): (timestamp: TimestampInput) => ResourceListTimeBucket {
  const current = now === undefined ? dayjs() : dayjs(now)
  if (!current.isValid()) {
    return () => 'earlier' as const
  }

  const todayStart = current.startOf('day')
  const todayStartMs = todayStart.valueOf()
  const tomorrowStartMs = todayStart.add(1, 'day').valueOf()
  const yesterdayStartMs = todayStart.subtract(1, 'day').valueOf()
  const weekStartMs = todayStart.startOf('week').valueOf()

  return (timestamp: TimestampInput): ResourceListTimeBucket => {
    if (timestamp === undefined) return 'earlier'

    const itemMs =
      typeof timestamp === 'number'
        ? timestamp
        : timestamp instanceof Date
          ? timestamp.valueOf()
          : dayjs(timestamp).valueOf()
    if (!Number.isFinite(itemMs)) return 'earlier'

    if (itemMs >= todayStartMs && itemMs < tomorrowStartMs) return 'today'
    if (itemMs >= yesterdayStartMs && itemMs < todayStartMs) return 'yesterday'
    if (itemMs >= weekStartMs && itemMs < yesterdayStartMs) return 'this-week'
    return 'earlier'
  }
}

export function getResourceTimeBucket(timestamp: TimestampInput, now?: TimestampInput): ResourceListTimeBucket {
  return createResourceTimeBucketResolver(now)(timestamp)
}

export function composeResourceListGroupResolvers<T>(
  ...resolvers: Array<ResourceListGroupResolver<T>>
): ResourceListGroupResolver<T> {
  return (item) => {
    for (const resolver of resolvers) {
      const group = resolver(item)
      if (group) return group
    }
    return null
  }
}

export function createPinnedGroupResolver<T>({
  group,
  isPinned
}: {
  group: ResourceListGroup
  isPinned: (item: T) => boolean
}): ResourceListGroupResolver<T> {
  return (item) => (isPinned(item) ? group : null)
}

export function createTimeGroupResolver<T>({
  getTimestamp,
  labels,
  now
}: {
  getTimestamp: (item: T) => TimestampInput
  labels: Record<ResourceListTimeBucket, string>
  now?: TimestampInput
}): ResourceListGroupResolver<T> {
  const resolveBucket = createResourceTimeBucketResolver(now)

  return (item) => {
    const bucket = resolveBucket(getTimestamp(item))
    return { id: `time:${bucket}`, label: labels[bucket] }
  }
}

export function createPinnedFirstSorter<T>({ isPinned }: { isPinned: (item: T) => boolean }): GroupRankResolver<T> {
  return (item) => (isPinned(item) ? 0 : 1)
}

export function sortByResourceGroupRank<T>(items: readonly T[], getGroupRank: GroupRankResolver<T>): T[] {
  return items
    .map((item, index) => ({ item, index, rank: getGroupRank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
}

export function sortRankedResourceItems<T>(
  items: readonly T[],
  {
    getRank,
    isPinned,
    compareWithinGroup
  }: {
    getRank: (item: T) => number
    isPinned: (item: T) => boolean
    compareWithinGroup: (a: T, b: T) => number
  }
): T[] {
  return items
    .map((item, index) => ({ item, index, rank: getRank(item), pinned: isPinned(item) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      if (a.pinned || b.pinned) return a.index - b.index
      const withinDelta = compareWithinGroup(a.item, b.item)
      if (withinDelta !== 0) return withinDelta
      return a.index - b.index
    })
    .map(({ item }) => item)
}

/**
 * Time-list specialization of `sortRankedResourceItems`.
 *
 * Parse each timestamp once before sorting instead of inside the O(n log n)
 * comparator path, and share the parsed value with time-bucket ranking.
 * Invalid timestamps retain their stable input order.
 */
export function sortRankedResourceItemsByRecency<T>(
  items: readonly T[],
  {
    getRank,
    getUpdatedAt,
    isPinned
  }: {
    getRank: (item: T, updatedAtMs: number) => number
    getUpdatedAt: (item: T) => string
    isPinned: (item: T) => boolean
  }
): T[] {
  return items
    .map((item, index) => {
      const updatedAtMs = Date.parse(getUpdatedAt(item))
      return {
        item,
        index,
        rank: getRank(item, updatedAtMs),
        pinned: isPinned(item),
        updatedAtMs
      }
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      if (a.pinned || b.pinned) return a.index - b.index
      if (Number.isFinite(a.updatedAtMs) && Number.isFinite(b.updatedAtMs)) {
        const recencyDelta = b.updatedAtMs - a.updatedAtMs
        if (recencyDelta !== 0) return recencyDelta
      }
      return a.index - b.index
    })
    .map(({ item }) => item)
}

export type ResourceListOrderAnchor = { before: string } | { after: string } | { position: 'last' }

export function compareResourceOrderKey(a?: string, b?: string) {
  if (a && b) {
    if (a < b) return -1
    if (a > b) return 1
  }

  return 0
}

export function buildResourceListItemDropAnchor(payload: ResourceListItemReorderPayload): ResourceListOrderAnchor {
  if (payload.overType === 'item') {
    return payload.position === 'before' ? { before: payload.overId } : { after: payload.overId }
  }

  return { position: 'last' }
}

export function buildResourceListGroupDropAnchor(
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>,
  overId: string
): ResourceListOrderAnchor {
  return payload.sourceIndex < payload.targetIndex ? { after: overId } : { before: overId }
}

export function moveResourceListStringGroupAfterDrop(
  ids: readonly string[],
  activeId: string,
  overId: string,
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>
): string[] {
  const activeIndex = ids.indexOf(activeId)
  const overIndex = ids.indexOf(overId)

  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return [...ids]
  }

  const next = ids.filter((id) => id !== activeId)
  const adjustedOverIndex = next.indexOf(overId)
  const insertIndex = payload.sourceIndex < payload.targetIndex ? adjustedOverIndex + 1 : adjustedOverIndex
  next.splice(insertIndex, 0, activeId)

  return next
}

export function withResourceListGroupIdPrefix<T>(
  prefix: string,
  resolver: ResourceListGroupResolver<T>
): ResourceListGroupResolver<T> {
  return (item) => {
    const group = resolver(item)
    if (!group) return null
    return { ...group, id: `${prefix}${group.id}` }
  }
}

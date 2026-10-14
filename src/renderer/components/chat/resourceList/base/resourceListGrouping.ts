import dayjs from 'dayjs'

import type { ResourceListGroup } from './ResourceListContext'

export type ResourceListTimeBucket = 'today' | 'yesterday' | 'this-week' | 'earlier'

export type ResourceListGroupResolver<T> = (item: T) => ResourceListGroup | null

type TimestampInput = dayjs.ConfigType
type GroupRankResolver<T> = (item: T) => number

export function getResourceTimeBucket(timestamp: TimestampInput, now?: TimestampInput): ResourceListTimeBucket {
  if (timestamp === undefined) {
    return 'earlier'
  }

  const item = dayjs(timestamp)
  const current = now === undefined ? dayjs() : dayjs(now)
  if (!item.isValid() || !current.isValid()) {
    return 'earlier'
  }

  const itemStart = item.startOf('day')
  const todayStart = current.startOf('day')

  if (itemStart.isSame(todayStart)) {
    return 'today'
  }

  const yesterdayStart = todayStart.subtract(1, 'day')
  if (itemStart.isSame(yesterdayStart)) {
    return 'yesterday'
  }

  const weekStart = todayStart.startOf('week')
  if (itemStart.isSame(weekStart) || (itemStart.isAfter(weekStart) && itemStart.isBefore(yesterdayStart))) {
    return 'this-week'
  }

  return 'earlier'
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
  return (item) => {
    const bucket = getResourceTimeBucket(getTimestamp(item), now)
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

/**
 * Shared display ordering for the topic/session rails, so the "grouped, then
 * pinned-first, then per-group order" precedence lives in one place instead of
 * being hand-rolled per surface (#16851). Precedence:
 *
 * 1. `getRank` — group rank (callers fold pinned to `0` so pins float to the top).
 * 2. Pinned rows keep their incoming order — the server returns them by
 *    `pin.orderKey`, so they are never reshuffled by the within-group key.
 * 3. `compareWithinGroup` — non-pinned order inside a group: recency
 *    (`compareResourceRecency`) for time views, `compareResourceOrderKey` for
 *    manual/drag views.
 * 4. Stable incoming-index tiebreak.
 */
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
 * Within-group recency comparator for `sortRankedResourceItems`: newest
 * `updatedAt` first. Unparseable timestamps compare equal so they defer to the
 * caller's stable index tiebreak rather than sorting arbitrarily.
 */
export function compareResourceRecency<T>(getUpdatedAt: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const aMs = Date.parse(getUpdatedAt(a))
    const bMs = Date.parse(getUpdatedAt(b))
    if (Number.isFinite(aMs) && Number.isFinite(bMs)) return bMs - aMs
    return 0
  }
}

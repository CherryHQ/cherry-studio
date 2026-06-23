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

import type { ResourceListGroup } from './ResourceListContext'

export type ResourceListTimeBucket = 'today' | 'within-week' | 'earlier'

export type ResourceListGroupResolver<T> = (item: T) => ResourceListGroup | null

type TimestampInput = string | number | Date | null | undefined
type GroupRankResolver<T> = (item: T) => number

export function getResourceTimeBucket(timestamp: TimestampInput, now: Date = new Date()): ResourceListTimeBucket {
  const value = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp ?? 0).getTime()
  if (!Number.isFinite(value)) {
    return 'earlier'
  }

  const date = new Date(value)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const itemStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  if (itemStart === todayStart) {
    return 'today'
  }

  const withinWeekStart = todayStart - 6 * 24 * 60 * 60 * 1000
  if (itemStart >= withinWeekStart && itemStart < todayStart) {
    return 'within-week'
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
  now?: Date
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

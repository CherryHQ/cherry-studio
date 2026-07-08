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

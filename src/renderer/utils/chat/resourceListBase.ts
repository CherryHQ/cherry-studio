export type ResourceListGroup = {
  id: string
  label: string
  count?: number
}

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

type GroupRankResolver<T> = (item: T) => number

export async function runResourceListLoadsWithConcurrency(
  groupIds: readonly string[],
  concurrency: number,
  load: (groupId: string) => Promise<unknown>
): Promise<void> {
  const queue = [...groupIds]
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), queue.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const groupId = queue.shift()
        if (!groupId) continue
        try {
          await load(groupId)
        } catch {
          // Each group owns its error state; one failure must not stop the remaining queue.
        }
      }
    })
  )
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
 * Shared topic/session display precedence: group rank first, pinned rows in
 * their incoming server order, then the caller's within-group ordering with a
 * stable incoming-index tiebreak.
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

function compareResourceTimestampOrder(aValue: string, bValue: string, aId: string, bId: string): number {
  const aMs = Date.parse(aValue)
  const bMs = Date.parse(bValue)
  if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return bMs - aMs
  if (Number.isFinite(aMs) !== Number.isFinite(bMs)) return Number.isFinite(aMs) ? -1 : 1
  return compareResourceIds(aId, bId)
}

export function compareResourceIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function compareResourceCreationOrder<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  return compareResourceTimestampOrder(a.createdAt, b.createdAt, a.id, b.id)
}

export function compareResourceUpdatedOrder<T extends { updatedAt: string; id: string }>(a: T, b: T): number {
  return compareResourceTimestampOrder(a.updatedAt, b.updatedAt, a.id, b.id)
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

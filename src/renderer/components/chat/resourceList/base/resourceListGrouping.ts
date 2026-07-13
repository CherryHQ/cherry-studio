import type { ResourceListGroup } from './ResourceListContext'

export type ResourceListGroupResolver<T> = (item: T) => ResourceListGroup | null

type GroupRankResolver<T> = (item: T) => number

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
 * Shared display ordering for the topic/session rails, so the "grouped, then
 * pinned-first, then per-group order" precedence lives in one place instead of
 * being hand-rolled per surface (#16851). Precedence:
 *
 * 1. `getRank` — group rank (callers fold pinned to `0` so pins float to the top).
 * 2. Pinned rows keep their incoming order — the server returns them by
 *    the server's business ordering, so they are never reshuffled by the within-group key.
 * 3. `compareWithinGroup` — non-pinned order inside a group.
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

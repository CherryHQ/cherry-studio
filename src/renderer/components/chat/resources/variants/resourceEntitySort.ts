import { getResourceTimeBucket, type ResourceListTimeBucket } from '../resourceListGrouping'

const RESOURCE_TIME_BUCKET_RANK: Record<ResourceListTimeBucket, number> = {
  today: 1,
  yesterday: 2,
  'this-week': 3,
  earlier: 4
}

export function sortResourceItemsByPinnedTime<T extends { pinned?: boolean; updatedAt: string }>(
  items: readonly T[],
  now?: Parameters<typeof getResourceTimeBucket>[1]
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      rank: item.pinned === true ? 0 : RESOURCE_TIME_BUCKET_RANK[getResourceTimeBucket(item.updatedAt, now)],
      updatedAtMs: Date.parse(item.updatedAt)
    }))
    .sort((a, b) => {
      const rankDelta = a.rank - b.rank
      if (rankDelta !== 0) return rankDelta

      if (a.item.pinned === true || b.item.pinned === true) return a.index - b.index

      if (Number.isFinite(a.updatedAtMs) && Number.isFinite(b.updatedAtMs)) {
        const updatedAtDelta = b.updatedAtMs - a.updatedAtMs
        if (updatedAtDelta !== 0) return updatedAtDelta
      }

      return a.index - b.index
    })
    .map(({ item }) => item)
}

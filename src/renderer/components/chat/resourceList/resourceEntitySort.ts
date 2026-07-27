import {
  createResourceTimeBucketResolver,
  type getResourceTimeBucket,
  type ResourceListTimeBucket,
  sortRankedResourceItemsByRecency
} from './base'

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
  const resolveTimeBucket = createResourceTimeBucketResolver(now)

  return sortRankedResourceItemsByRecency(items, {
    getRank: (item, updatedAtMs) =>
      item.pinned === true ? 0 : RESOURCE_TIME_BUCKET_RANK[resolveTimeBucket(updatedAtMs)],
    isPinned: (item) => item.pinned === true,
    getUpdatedAt: (item) => item.updatedAt
  })
}

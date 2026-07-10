import {
  compareResourceRecency,
  getResourceTimeBucket,
  type ResourceListTimeBucket,
  sortRankedResourceItems
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
  return sortRankedResourceItems(items, {
    getRank: (item) =>
      item.pinned === true ? 0 : RESOURCE_TIME_BUCKET_RANK[getResourceTimeBucket(item.updatedAt, now)],
    isPinned: (item) => item.pinned === true,
    compareWithinGroup: compareResourceRecency((item) => item.updatedAt)
  })
}

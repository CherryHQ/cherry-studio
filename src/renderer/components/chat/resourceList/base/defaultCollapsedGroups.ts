import type { ResourceListGroup } from './ResourceListContext'

export function resolveDefaultCollapsedGroupIds<T>({
  collapsedIds,
  groupBy,
  items
}: {
  collapsedIds: readonly string[] | null
  groupBy: (item: T) => ResourceListGroup | null
  items: readonly T[]
}): readonly string[] {
  if (collapsedIds !== null) return collapsedIds

  const groupIds = new Set<string>()
  for (const item of items) {
    const group = groupBy(item)
    if (group?.label) groupIds.add(group.id)
  }

  return [...groupIds]
}

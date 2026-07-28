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

/**
 * When new groups appear (e.g. a freshly added assistant / agent), keep the list's collapse state
 * consistent: if every pre-existing group is already collapsed (the user has "collapsed all"), the
 * new group should default to collapsed too instead of popping open. If any existing group is still
 * expanded, the new group is left alone (expands as normal).
 *
 * Pure helper so both the conversation (Topics) and work (Sessions) modules share identical logic
 * and it can be unit-tested. Returns the next collapsed-id array, or `null` when nothing changes.
 */
export function resolveCollapsedIdsForNewGroups({
  collapsedIds,
  currentGroupIds,
  previousGroupIds
}: {
  collapsedIds: readonly string[]
  currentGroupIds: readonly string[]
  previousGroupIds: readonly string[]
}): readonly string[] | null {
  const previousSet = new Set(previousGroupIds)
  const newGroupIds = currentGroupIds.filter((id) => !previousSet.has(id))
  if (newGroupIds.length === 0) return null

  const newGroupIdSet = new Set(newGroupIds)
  const existingGroupIds = currentGroupIds.filter((id) => !newGroupIdSet.has(id))
  // Only follow the "all collapsed" state when there is at least one pre-existing group to compare
  // against — never collapse groups on the very first population of the list.
  if (existingGroupIds.length === 0) return null

  const collapsedIdSet = new Set(collapsedIds)
  const allExistingCollapsed = existingGroupIds.every((id) => collapsedIdSet.has(id))
  if (!allExistingCollapsed) return null

  const idsToCollapse = newGroupIds.filter((id) => !collapsedIdSet.has(id))
  if (idsToCollapse.length === 0) return null

  return [...collapsedIds, ...idsToCollapse]
}

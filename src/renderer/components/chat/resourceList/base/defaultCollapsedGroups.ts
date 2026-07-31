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
 * `previousGroupIds` is the set of groups already observed (accumulated across renders by the
 * caller), not merely the last snapshot. A group counts as "new" only if it was never observed
 * before, so a group that was only temporarily absent — pinned away, or not yet paged in during a
 * progressive load — is not mistaken for a freshly created one when it reappears.
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

  // Never collapse on the very first population — there is no pre-existing state to mirror.
  if (previousGroupIds.length === 0) return null

  // Determine "all collapsed" from every previously observed group, not just the ones that survived
  // into the current snapshot: an expanded group that disappears in the same update (e.g. its last
  // topic moves to another assistant) still means the user was not in a fully-collapsed state.
  const collapsedIdSet = new Set(collapsedIds)
  const allPreviousCollapsed = previousGroupIds.every((id) => collapsedIdSet.has(id))
  if (!allPreviousCollapsed) return null

  const idsToCollapse = newGroupIds.filter((id) => !collapsedIdSet.has(id))
  if (idsToCollapse.length === 0) return null

  return [...collapsedIds, ...idsToCollapse]
}

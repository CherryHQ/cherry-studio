import type { ResourceListExpansionState } from './ResourceListContext'

export function remapResourceListExpandedGroupIds(
  state: ResourceListExpansionState,
  mapGroupId: (groupId: string) => string
): ResourceListExpansionState {
  return {
    expandedSectionIds: [...state.expandedSectionIds],
    expandedGroupIds: Array.from(new Set(state.expandedGroupIds.map(mapGroupId)))
  }
}

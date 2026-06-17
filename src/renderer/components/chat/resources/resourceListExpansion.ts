import type { ResourceListExpansionState } from './ResourceListContext'

export function updateResourceListExpansionState<M extends string>(
  expansion: Record<M, ResourceListExpansionState>,
  mode: M,
  nextState: ResourceListExpansionState
): Record<M, ResourceListExpansionState> {
  return {
    ...expansion,
    [mode]: {
      expandedSectionIds: [...nextState.expandedSectionIds],
      expandedGroupIds: [...nextState.expandedGroupIds]
    }
  }
}

export function remapResourceListExpandedGroupIds(
  state: ResourceListExpansionState,
  mapGroupId: (groupId: string) => string
): ResourceListExpansionState {
  return {
    expandedSectionIds: [...state.expandedSectionIds],
    expandedGroupIds: Array.from(new Set(state.expandedGroupIds.map(mapGroupId)))
  }
}

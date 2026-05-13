import { createContext, type ReactNode, use } from 'react'

export type ResourceListItemBase = {
  id: string
  name: string
  description?: string
}

export type ResourceListStatus = 'idle' | 'loading' | 'error' | 'empty'

export type ResourceListGroup = {
  id: string
  label: string
  count?: number
}

export type ResourceListGroupHeaderIconContext = {
  collapsed: boolean
}

export type ResourceListSortOption<T extends ResourceListItemBase> = {
  id: string
  label: string
  comparator: (a: T, b: T) => number
}

export type ResourceListFilterOption<T extends ResourceListItemBase> = {
  id: string
  label: string
  predicate: (item: T) => boolean
}

export type ResourceListDragCapabilities = {
  groups?: boolean
  items?: boolean
  itemSameGroup?: boolean
  itemCrossGroup?: boolean
}

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

export type ResourceListReorderPayload = ResourceListItemReorderPayload | ResourceListGroupReorderPayload

export type ResourceListVariantContext = {
  variant: 'session' | 'topic' | 'agent' | 'assistant' | 'history' | 'resource'
}

export type ResourceListState = {
  query: string
  filters: string[]
  sort: string | null
  selectedId: string | null
  hoveredId: string | null
  renamingId: string | null
  collapsedGroups: string[]
  groupVisibleCounts: Record<string, number>
  draggingId: string | null
  status: ResourceListStatus
}

export type ResourceListActionMap = {
  setQuery: (query: string) => void
  setFilters: (filters: string[]) => void
  toggleFilter: (filterId: string) => void
  setSort: (sortId: string | null) => void
  selectItem: (id: string) => void
  hoverItem: (id: string | null) => void
  startRename: (id: string) => void
  commitRename: (id: string, name: string) => void
  cancelRename: () => void
  openContextMenu: (id: string) => void
  showMoreInGroup: (groupId: string) => void
  collapseGroupItems: (groupId: string) => void
  toggleGroup: (groupId: string) => void
  reorder: (payload: ResourceListReorderPayload) => void
}

export type ResourceListMeta<T extends ResourceListItemBase> = {
  variant: ResourceListVariantContext['variant']
  getItemId: (item: T) => string
  getItemLabel: (item: T) => string
  groups: ResourceListGroup[]
  getGroupHeaderAction?: (group: ResourceListGroup) => ReactNode
  getGroupHeaderIcon?: (group: ResourceListGroup, context: ResourceListGroupHeaderIconContext) => ReactNode
  sortOptions: ResourceListSortOption<T>[]
  filterOptions: ResourceListFilterOption<T>[]
  estimateItemSize: (index: number) => number
  defaultGroupVisibleCount: number
  groupLoadStep: number
  groupShowMoreLabel?: string
  groupCollapseLabel?: string
  dragCapabilities: ResourceListDragCapabilities
  canDragGroup?: (group: ResourceListGroup, groupIndex: number) => boolean
  canDragItem?: (args: {
    item: T
    itemIndex: number
    group: ResourceListGroup
    groupIndex: number
    itemIndexInGroup: number
  }) => boolean
  canDropGroup?: (args: {
    activeGroupId: string
    overGroupId: string
    overType: 'group' | 'item'
    sourceIndex: number
    targetIndex: number
  }) => boolean
  canDropItem?: (args: {
    activeId: string
    activeItem: T
    overId: string
    overItem?: T
    overType: 'group' | 'item'
    sourceGroup: ResourceListGroup
    sourceGroupId: string
    sourceIndex: number
    targetGroup: ResourceListGroup
    targetGroupId: string
    targetIndex: number
  }) => boolean
}

export type ResourceListViewGroup<T extends ResourceListItemBase> = {
  group: ResourceListGroup
  allItems: T[]
  items: T[]
  totalCount: number
  visibleCount: number
  hasMore: boolean
  canCollapseToDefault: boolean
  collapsed: boolean
}

export type ResourceListView<T extends ResourceListItemBase> = {
  items: T[]
  visibleItems: T[]
  groups: ResourceListViewGroup<T>[]
}

export type ResourceListContextValue<T extends ResourceListItemBase> = {
  state: ResourceListState
  actions: ResourceListActionMap
  meta: ResourceListMeta<T>
  sourceItems: readonly T[]
  view: ResourceListView<T>
}

export const ResourceListContext = createContext<ResourceListContextValue<ResourceListItemBase> | null>(null)

export function useResourceList<T extends ResourceListItemBase = ResourceListItemBase>() {
  const context = use(ResourceListContext)
  if (!context) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return context as unknown as ResourceListContextValue<T>
}

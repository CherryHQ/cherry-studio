import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'

import {
  ResourceListActionsContext,
  ResourceListContext,
  type ResourceListContextValue,
  ResourceListControlsContext,
  type ResourceListControlsState,
  type ResourceListDragCapabilities,
  type ResourceListFilterOption,
  type ResourceListGroup,
  type ResourceListGroupHeaderClickBehavior,
  type ResourceListGroupSeed,
  type ResourceListItemAccessors,
  ResourceListItemAccessorsContext,
  type ResourceListItemBase,
  type ResourceListMeta,
  ResourceListMetaContext,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  type ResourceListSortOption,
  ResourceListSourceItemsContext,
  type ResourceListState,
  type ResourceListStatus,
  ResourceListUiStoreContext,
  type ResourceListVariantContext,
  type ResourceListView,
  ResourceListViewContext,
  type ResourceListViewGroup,
  type ResourceListViewSection
} from './ResourceListContext'
import { RESOURCE_LIST_DEFAULT_ROW_SIZE } from './resourceListLayout'
import { ResourceListUiService } from './ResourceListUiService'

const EMPTY_SORT_OPTIONS: ResourceListSortOption<ResourceListItemBase>[] = []
const EMPTY_FILTER_OPTIONS: ResourceListFilterOption<ResourceListItemBase>[] = []
const EMPTY_GROUP_SEEDS: readonly ResourceListGroupSeed[] = []
const getDefaultItemId = (item: ResourceListItemBase) => item.id
const getDefaultItemLabel = (item: ResourceListItemBase) => item.name
const estimateDefaultItemSize = () => RESOURCE_LIST_DEFAULT_ROW_SIZE
const UNGROUPED_RESOURCE_GROUP: ResourceListGroup = { id: 'ungrouped', label: '' }
const UNSECTIONED_RESOURCE_SECTION: ResourceListSection = { id: 'resource-list:section:unsectioned', label: '' }

type ResourceListGroupHeaderClickBehaviorResolver =
  | ResourceListGroupHeaderClickBehavior
  | ((group: ResourceListGroup) => ResourceListGroupHeaderClickBehavior)

type DeriveResourceListItemsOptions<T extends ResourceListItemBase> = {
  filterById: ReadonlyMap<string, ResourceListFilterOption<T>>
  filters: readonly string[]
  getItemLabel: (item: T) => string
  items: readonly T[]
  query: string
  sortById: ReadonlyMap<string, ResourceListSortOption<T>>
  sortId: string | null
}

type BuildResourceListGroupsOptions<T extends ResourceListItemBase> = {
  collapsedIds: readonly string[]
  defaultGroupVisibleCount: number
  groupBy?: (item: T) => ResourceListGroup | null
  groupSeeds?: readonly ResourceListGroup[]
  groupVisibleCounts: Record<string, number>
  items: readonly T[]
}

type BuildResourceListSectionsOptions<T extends ResourceListItemBase> = BuildResourceListGroupsOptions<T> & {
  groupSeeds?: readonly ResourceListGroupSeed[]
  sectionBy?: (item: T) => ResourceListSection | null
}

type FindRevealTargetOptions<T extends ResourceListItemBase> = {
  defaultGroupVisibleCount: number
  getItemId: (item: T) => string
  groupBy?: (item: T) => ResourceListGroup | null
  groupVisibleCounts: Record<string, number>
  itemId: string
  items: readonly T[]
  sectionBy?: (item: T) => ResourceListSection | null
}

function getResourceListGroup<T extends ResourceListItemBase>(
  item: T,
  groupBy?: (item: T) => ResourceListGroup | null
) {
  return groupBy?.(item) ?? UNGROUPED_RESOURCE_GROUP
}

function getResourceListGroupFromSeed(group: ResourceListGroupSeed): ResourceListGroup {
  return { id: group.id, label: group.label, count: group.count }
}

function normalizeCollapsedIds(collapsedIds: readonly string[] | unknown): readonly string[] {
  return Array.isArray(collapsedIds) ? collapsedIds : []
}

function deriveResourceListItems<T extends ResourceListItemBase>({
  filterById,
  filters,
  getItemLabel,
  items,
  query,
  sortById,
  sortId
}: DeriveResourceListItemsOptions<T>) {
  const normalizedQuery = query.trim().toLowerCase()
  let next = [...items]

  if (normalizedQuery) {
    next = next.filter((item) => getItemLabel(item).toLowerCase().includes(normalizedQuery))
  }

  if (filters.length > 0) {
    next = next.filter((item) => {
      for (const filterId of filters) {
        const filter = filterById.get(filterId)
        if (filter && !filter.predicate(item)) return false
      }
      return true
    })
  }

  const sort = sortId ? sortById.get(sortId) : null
  if (sort) {
    next.sort(sort.comparator)
  }

  return next
}

function buildResourceListGroups<T extends ResourceListItemBase>({
  collapsedIds,
  defaultGroupVisibleCount,
  groupBy,
  groupSeeds = EMPTY_GROUP_SEEDS,
  groupVisibleCounts,
  items
}: BuildResourceListGroupsOptions<T>): ResourceListViewGroup<T>[] {
  const collapsedIdSet = new Set(collapsedIds)

  if (!groupBy) {
    const group = { id: 'all', label: '' }
    return [
      {
        group,
        allItems: [...items],
        items: [...items],
        totalCount: items.length,
        visibleCount: items.length,
        hasMore: false,
        canCollapseToDefault: false,
        collapsed: false
      }
    ]
  }

  const groups = new Map<string, { group: ResourceListGroup; items: T[] }>()
  for (const group of groupSeeds) {
    groups.set(group.id, { group, items: [] })
  }

  for (const item of items) {
    const group = getResourceListGroup(item, groupBy)
    const existing = groups.get(group.id)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(group.id, { group, items: [item] })
    }
  }

  return [...groups.values()].map(({ group, items }) => {
    const totalCount = items.length
    const collapsed = Boolean(group.label) && collapsedIdSet.has(group.id)
    const configuredVisibleCount = groupVisibleCounts[group.id] ?? defaultGroupVisibleCount
    const visibleCount = Math.min(configuredVisibleCount, totalCount)
    const hasMore = !collapsed && visibleCount < totalCount
    const canCollapseToDefault = !collapsed && totalCount > defaultGroupVisibleCount && visibleCount >= totalCount

    return {
      group: { ...group, count: group.count ?? totalCount },
      allItems: items,
      items: collapsed ? [] : items.slice(0, visibleCount),
      totalCount,
      visibleCount: collapsed ? 0 : visibleCount,
      hasMore,
      canCollapseToDefault,
      collapsed
    }
  })
}

function buildResourceListSections<T extends ResourceListItemBase>({
  collapsedIds,
  defaultGroupVisibleCount,
  groupBy,
  groupSeeds = EMPTY_GROUP_SEEDS,
  groupVisibleCounts,
  items,
  sectionBy
}: BuildResourceListSectionsOptions<T>): ResourceListViewSection<T>[] {
  if (!sectionBy) return []

  const collapsedIdSet = new Set(collapsedIds)
  const sections = new Map<string, { section: ResourceListSection; items: T[]; groupSeeds: ResourceListGroup[] }>()

  for (const item of items) {
    const section = sectionBy(item) ?? UNSECTIONED_RESOURCE_SECTION

    const existing = sections.get(section.id)
    if (existing) {
      existing.items.push(item)
    } else {
      sections.set(section.id, { section, items: [item], groupSeeds: [] })
    }
  }

  for (const groupSeed of groupSeeds) {
    const section = groupSeed.section ?? UNSECTIONED_RESOURCE_SECTION
    const group = getResourceListGroupFromSeed(groupSeed)
    const existing = sections.get(section.id)
    if (existing) {
      existing.groupSeeds.push(group)
    } else {
      sections.set(section.id, { section, items: [], groupSeeds: [group] })
    }
  }

  const sectionEntries = [...sections.values()]
  const showSectionHeaders = sectionEntries.length > 1

  return sectionEntries.map(({ section, items, groupSeeds }) => {
    const collapsed = showSectionHeaders && Boolean(section.label) && collapsedIdSet.has(section.id)
    const groups = buildResourceListGroups({
      collapsedIds,
      defaultGroupVisibleCount,
      groupBy,
      groupSeeds,
      groupVisibleCounts,
      items
    })
    const visibleGroups = collapsed
      ? groups.map((group) => ({
          ...group,
          items: [],
          visibleCount: 0,
          hasMore: false,
          canCollapseToDefault: false
        }))
      : groups

    return {
      section: { ...section, count: section.count ?? items.length },
      groups: visibleGroups,
      allItems: items,
      totalCount: items.length,
      collapsed
    }
  })
}

function buildSectionStateGroups<T extends ResourceListItemBase>(
  sections: readonly ResourceListViewSection<T>[]
): ResourceListViewGroup<T>[] {
  return sections.map((section) => ({
    group: section.section,
    allItems: section.allItems,
    items: section.collapsed ? [] : section.groups.flatMap((group) => group.items),
    totalCount: section.totalCount,
    visibleCount: section.collapsed ? 0 : section.groups.reduce((count, group) => count + group.visibleCount, 0),
    hasMore: false,
    canCollapseToDefault: false,
    collapsed: section.collapsed
  }))
}

function findResourceListRevealTarget<T extends ResourceListItemBase>({
  defaultGroupVisibleCount,
  getItemId,
  groupBy,
  groupVisibleCounts,
  itemId,
  items,
  sectionBy
}: FindRevealTargetOptions<T>) {
  const targetItem = items.find((item) => getItemId(item) === itemId)
  if (!targetItem) return null
  const targetSectionId = sectionBy ? (sectionBy(targetItem)?.id ?? UNSECTIONED_RESOURCE_SECTION.id) : null

  if (!groupBy) {
    return { targetGroupId: null, targetSectionId, visibleCount: undefined }
  }

  const targetGroupId = getResourceListGroup(targetItem, groupBy).id
  const groupItems = items.filter((item) => getResourceListGroup(item, groupBy).id === targetGroupId)
  const targetIndexInGroup = groupItems.findIndex((item) => getItemId(item) === itemId)
  const currentVisibleCount = groupVisibleCounts[targetGroupId] ?? defaultGroupVisibleCount
  const targetVisibleCount = targetIndexInGroup + 1
  const visibleCount =
    targetIndexInGroup >= 0 && targetVisibleCount > currentVisibleCount ? targetVisibleCount : undefined

  return { targetGroupId, targetSectionId, visibleCount }
}

export type ResourceListProviderProps<T extends ResourceListItemBase> = {
  items: readonly T[]
  children: ReactNode
  variant?: ResourceListVariantContext['variant']
  status?: ResourceListStatus
  selectedId?: string | null
  defaultSortId?: string
  sortOptions?: ResourceListSortOption<T>[]
  filterOptions?: ResourceListFilterOption<T>[]
  groupBy?: (item: T) => ResourceListGroup | null
  groupSeeds?: readonly ResourceListGroupSeed[]
  sectionBy?: (item: T) => ResourceListSection | null
  getItemId?: (item: T) => string
  getItemLabel?: (item: T) => string
  getSectionHeaderAction?: ResourceListMeta<T>['getSectionHeaderAction']
  getGroupHeaderAction?: (group: ResourceListGroup) => ReactNode
  getGroupHeaderContextMenu?: ResourceListMeta<T>['getGroupHeaderContextMenu']
  getGroupHeaderLeadingAction?: ResourceListMeta<T>['getGroupHeaderLeadingAction']
  getGroupHeaderIcon?: ResourceListMeta<T>['getGroupHeaderIcon']
  getGroupHeaderClassName?: ResourceListMeta<T>['getGroupHeaderClassName']
  getGroupHeaderTooltip?: ResourceListMeta<T>['getGroupHeaderTooltip']
  groupHeaderClickBehavior?: ResourceListGroupHeaderClickBehaviorResolver
  collapsedState?: readonly string[]
  revealRequest?: ResourceListRevealRequest
  dragCapabilities?: ResourceListDragCapabilities
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
  defaultGroupVisibleCount?: number
  groupLoadStep?: number
  groupShowMoreLabel?: string
  groupCollapseLabel?: string
  estimateItemSize?: (index: number) => number
  onSelectItem?: (id: string) => void
  onRenameItem?: (id: string, name: string) => void
  onGroupHeaderSelectItem?: (id: string) => void
  onEmptyGroupHeaderClick?: (group: ResourceListGroup) => boolean | void
  onOpenContextMenu?: (id: string) => void
  onReorder?: (payload: ResourceListReorderPayload) => void
  onCollapsedStateChange?: (collapsedIds: string[]) => void
}

type ResourceListProviderState = Omit<ResourceListState, 'status'>

type ProviderAction =
  | { type: 'setQuery'; query: string }
  | { type: 'setFilters'; filters: string[] }
  | { type: 'toggleFilter'; filterId: string }
  | { type: 'setSort'; sort: string | null }
  | { type: 'setActiveItem'; id: string | null }
  | { type: 'selectItem'; id: string | null }
  | { type: 'startRename'; id: string }
  | { type: 'cancelRename' }
  | { type: 'showMoreInGroup'; groupId: string }
  | { type: 'collapseGroupItems'; groupId: string; defaultCount: number }
  | { type: 'expandGroups'; groupIds: readonly string[] }
  | { type: 'collapseGroups'; groupIds: readonly string[]; defaultCount: number }
  | { type: 'resetGroupVisibleCounts'; groupIds: readonly string[]; defaultCount: number }
  | { type: 'toggleGroup'; groupId: string }
  | {
      type: 'revealItem'
      clearFilters?: boolean
      clearQuery?: boolean
      groupIds: string[]
      itemId: string
      requestId: number
      visibleCount?: number
    }
  | { type: 'clearRevealFocus'; itemId: string; requestId: number }
  | { type: 'startDrag'; id: string }
  | { type: 'endDrag' }

function reducer(state: ResourceListProviderState, action: ProviderAction): ResourceListProviderState {
  switch (action.type) {
    case 'setQuery':
      return { ...state, query: action.query }
    case 'setFilters':
      return { ...state, filters: action.filters }
    case 'toggleFilter': {
      const next = new Set(state.filters)
      if (next.has(action.filterId)) {
        next.delete(action.filterId)
      } else {
        next.add(action.filterId)
      }
      return { ...state, filters: [...next] }
    }
    case 'setSort':
      return { ...state, sort: action.sort }
    case 'setActiveItem':
      if (state.activeId === action.id) return state
      return { ...state, activeId: action.id }
    case 'selectItem':
      if (state.selectedId === action.id && state.activeId === action.id) return state
      return { ...state, activeId: action.id, selectedId: action.id }
    case 'startRename':
      return { ...state, renamingId: action.id }
    case 'cancelRename':
      return { ...state, renamingId: null }
    case 'showMoreInGroup': {
      return {
        ...state,
        groupVisibleCounts: {
          ...state.groupVisibleCounts,
          [action.groupId]: Number.POSITIVE_INFINITY
        }
      }
    }
    case 'collapseGroupItems':
      return {
        ...state,
        groupVisibleCounts: {
          ...state.groupVisibleCounts,
          [action.groupId]: action.defaultCount
        }
      }
    case 'expandGroups':
      return {
        ...state,
        collapsedGroups: state.collapsedGroups.filter((groupId) => !action.groupIds.includes(groupId))
      }
    case 'collapseGroups': {
      const collapsedGroups = new Set(state.collapsedGroups)
      const groupVisibleCounts = { ...state.groupVisibleCounts }
      for (const groupId of action.groupIds) {
        collapsedGroups.add(groupId)
        groupVisibleCounts[groupId] = action.defaultCount
      }
      return { ...state, collapsedGroups: [...collapsedGroups], groupVisibleCounts }
    }
    case 'resetGroupVisibleCounts': {
      const groupVisibleCounts = { ...state.groupVisibleCounts }
      for (const groupId of action.groupIds) {
        groupVisibleCounts[groupId] = action.defaultCount
      }
      return { ...state, groupVisibleCounts }
    }
    case 'toggleGroup': {
      const collapsedGroups = state.collapsedGroups.includes(action.groupId)
        ? state.collapsedGroups.filter((groupId) => groupId !== action.groupId)
        : [...state.collapsedGroups, action.groupId]
      return { ...state, collapsedGroups }
    }
    case 'revealItem': {
      const nextGroupVisibleCounts = { ...state.groupVisibleCounts }

      const targetGroupId = action.groupIds[0]
      if (targetGroupId && action.visibleCount !== undefined) {
        nextGroupVisibleCounts[targetGroupId] = Math.max(
          nextGroupVisibleCounts[targetGroupId] ?? 0,
          action.visibleCount
        )
      }

      return {
        ...state,
        query: action.clearQuery ? '' : state.query,
        filters: action.clearFilters ? [] : state.filters,
        collapsedGroups:
          action.groupIds.length > 0
            ? state.collapsedGroups.filter((groupId) => !action.groupIds.includes(groupId))
            : state.collapsedGroups,
        groupVisibleCounts: nextGroupVisibleCounts,
        activeId: action.itemId,
        revealFocus: { itemId: action.itemId, requestId: action.requestId }
      }
    }
    case 'clearRevealFocus': {
      if (state.revealFocus?.itemId !== action.itemId || state.revealFocus.requestId !== action.requestId) {
        return state
      }

      return { ...state, revealFocus: null }
    }
    case 'startDrag':
      return { ...state, draggingId: action.id }
    case 'endDrag':
      return { ...state, draggingId: null }
  }
}

export function ResourceListProvider<T extends ResourceListItemBase>({
  items,
  children,
  variant = 'resource',
  status = 'idle',
  selectedId: selectedIdProp,
  defaultSortId,
  sortOptions = EMPTY_SORT_OPTIONS as ResourceListSortOption<T>[],
  filterOptions = EMPTY_FILTER_OPTIONS as ResourceListFilterOption<T>[],
  groupBy,
  groupSeeds = EMPTY_GROUP_SEEDS,
  sectionBy,
  getItemId = getDefaultItemId as (item: T) => string,
  getItemLabel = getDefaultItemLabel as (item: T) => string,
  getSectionHeaderAction,
  getGroupHeaderAction,
  getGroupHeaderContextMenu,
  getGroupHeaderLeadingAction,
  getGroupHeaderIcon,
  getGroupHeaderClassName,
  getGroupHeaderTooltip,
  groupHeaderClickBehavior = 'toggle',
  collapsedState,
  revealRequest,
  dragCapabilities,
  canDragGroup,
  canDragItem,
  canDropGroup,
  canDropItem,
  defaultGroupVisibleCount = 5,
  groupLoadStep = 5,
  groupShowMoreLabel,
  groupCollapseLabel,
  estimateItemSize = estimateDefaultItemSize,
  onSelectItem,
  onRenameItem,
  onGroupHeaderSelectItem,
  onEmptyGroupHeaderClick,
  onOpenContextMenu,
  onReorder,
  onCollapsedStateChange
}: ResourceListProviderProps<T>) {
  const [state, dispatch] = useReducer(reducer, {
    activeId: selectedIdProp ?? null,
    query: '',
    filters: [],
    sort: defaultSortId ?? null,
    selectedId: selectedIdProp ?? null,
    revealFocus: null,
    renamingId: null,
    collapsedGroups: [],
    groupVisibleCounts: {},
    draggingId: null
  })

  const filterById = useMemo(() => new Map(filterOptions.map((option) => [option.id, option])), [filterOptions])
  const sortById = useMemo(() => new Map(sortOptions.map((option) => [option.id, option])), [sortOptions])
  const isControlled = collapsedState !== undefined
  const effectiveCollapsedIds = normalizeCollapsedIds(collapsedState ?? state.collapsedGroups)
  const effectiveSelectedId = selectedIdProp !== undefined ? selectedIdProp : state.selectedId
  const isSelectedControlled = selectedIdProp !== undefined
  const handledRevealRequestRef = useRef<string | null>(null)
  const collapsedStateRef = useRef<readonly string[]>([])
  const uiStoreRef = useRef<ResourceListUiService | null>(null)
  if (!uiStoreRef.current) {
    uiStoreRef.current = new ResourceListUiService({
      activeId: state.activeId,
      draggingId: state.draggingId,
      renamingId: state.renamingId,
      revealFocus: state.revealFocus,
      selectedId: effectiveSelectedId
    })
  }
  const uiStore = uiStoreRef.current
  const getGroupHeaderClickBehavior = useCallback(
    (group: ResourceListGroup) =>
      typeof groupHeaderClickBehavior === 'function' ? groupHeaderClickBehavior(group) : groupHeaderClickBehavior,
    [groupHeaderClickBehavior]
  )
  const seedGroups = useMemo(() => groupSeeds.map(getResourceListGroupFromSeed), [groupSeeds])

  useEffect(() => {
    if (!revealRequest) return

    const requestKey = `${revealRequest.requestId}:${revealRequest.itemId}`
    if (handledRevealRequestRef.current === requestKey) return

    const query = revealRequest.clearQuery ? '' : state.query
    const filters = revealRequest.clearFilters ? [] : state.filters
    const revealItems = deriveResourceListItems({
      filterById,
      filters,
      getItemLabel,
      items,
      query,
      sortById,
      sortId: state.sort
    })
    const revealTarget = findResourceListRevealTarget({
      defaultGroupVisibleCount,
      getItemId,
      groupBy,
      groupVisibleCounts: state.groupVisibleCounts,
      itemId: revealRequest.itemId,
      items: revealItems,
      sectionBy
    })
    if (!revealTarget) return
    const revealGroupIds = [revealTarget.targetGroupId].filter(
      (groupId): groupId is string => typeof groupId === 'string'
    )
    const revealSectionIds = [revealTarget.targetSectionId].filter(
      (sectionId): sectionId is string => typeof sectionId === 'string'
    )
    const revealIds = [...revealGroupIds, ...revealSectionIds]

    if (isControlled && revealIds.some((id) => effectiveCollapsedIds.includes(id))) {
      const nextCollapsedIds = effectiveCollapsedIds.filter((id) => !revealIds.includes(id))
      collapsedStateRef.current = nextCollapsedIds
      onCollapsedStateChange?.(nextCollapsedIds)
    }

    handledRevealRequestRef.current = requestKey
    dispatch({
      type: 'revealItem',
      clearFilters: revealRequest.clearFilters,
      clearQuery: revealRequest.clearQuery,
      groupIds: [...revealGroupIds, ...revealSectionIds],
      itemId: revealRequest.itemId,
      requestId: revealRequest.requestId,
      visibleCount: revealTarget.visibleCount
    })
  }, [
    isControlled,
    effectiveCollapsedIds,
    filterById,
    defaultGroupVisibleCount,
    getItemId,
    getItemLabel,
    groupBy,
    items,
    onCollapsedStateChange,
    revealRequest,
    sectionBy,
    sortById,
    state.filters,
    state.groupVisibleCounts,
    state.query,
    state.sort
  ])

  useEffect(() => {
    if (!state.revealFocus) return

    const { itemId, requestId } = state.revealFocus
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'clearRevealFocus', itemId, requestId })
    }, 1000)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [state.revealFocus])

  const viewItems = useMemo(() => {
    return deriveResourceListItems({
      filterById,
      filters: state.filters,
      getItemLabel,
      items,
      query: state.query,
      sortById,
      sortId: state.sort
    })
  }, [filterById, getItemLabel, items, sortById, state.filters, state.query, state.sort])

  const viewSections = useMemo(() => {
    return buildResourceListSections({
      collapsedIds: effectiveCollapsedIds,
      defaultGroupVisibleCount,
      groupBy,
      groupSeeds,
      groupVisibleCounts: state.groupVisibleCounts,
      items: viewItems,
      sectionBy
    })
  }, [
    defaultGroupVisibleCount,
    effectiveCollapsedIds,
    groupBy,
    groupSeeds,
    sectionBy,
    state.groupVisibleCounts,
    viewItems
  ])

  const viewGroups = useMemo(() => {
    if (sectionBy) return viewSections.flatMap((section) => section.groups)

    return buildResourceListGroups({
      collapsedIds: effectiveCollapsedIds,
      defaultGroupVisibleCount,
      groupBy,
      groupSeeds: seedGroups,
      groupVisibleCounts: state.groupVisibleCounts,
      items: viewItems
    })
  }, [
    defaultGroupVisibleCount,
    effectiveCollapsedIds,
    groupBy,
    sectionBy,
    seedGroups,
    state.groupVisibleCounts,
    viewItems,
    viewSections
  ])

  const visibleItems = useMemo(() => viewGroups.flatMap((group) => group.items), [viewGroups])
  const stateGroups = useMemo(
    () => (sectionBy ? [...buildSectionStateGroups(viewSections), ...viewGroups] : viewGroups),
    [sectionBy, viewGroups, viewSections]
  )
  useLayoutEffect(() => {
    uiStore.setSelectedId(effectiveSelectedId)
  }, [effectiveSelectedId, uiStore])

  useEffect(() => {
    uiStore.setActiveId(state.activeId)
  }, [state.activeId, uiStore])

  useLayoutEffect(() => {
    uiStore.setActiveId(effectiveSelectedId)
    dispatch({ type: 'setActiveItem', id: effectiveSelectedId })
  }, [effectiveSelectedId, uiStore])

  useLayoutEffect(() => {
    uiStore.setRenamingId(state.renamingId)
  }, [state.renamingId, uiStore])

  useLayoutEffect(() => {
    uiStore.setRevealFocus(state.revealFocus)
  }, [state.revealFocus, uiStore])

  useLayoutEffect(() => {
    uiStore.setDraggingId(state.draggingId)
  }, [state.draggingId, uiStore])

  useLayoutEffect(() => {
    uiStore.setViewGroups(stateGroups, getItemId)
  }, [getItemId, stateGroups, uiStore])

  useLayoutEffect(() => {
    collapsedStateRef.current = effectiveCollapsedIds
  }, [effectiveCollapsedIds])

  const notifyControlledCollapsedStateChange = useCallback(
    (nextCollapsedIds: readonly string[]) => {
      const next = [...new Set(nextCollapsedIds)]
      collapsedStateRef.current = next
      onCollapsedStateChange?.(next)
    },
    [onCollapsedStateChange]
  )

  const actions = useMemo(
    () => ({
      setQuery: (query: string) => dispatch({ type: 'setQuery', query }),
      setFilters: (filters: string[]) => dispatch({ type: 'setFilters', filters }),
      toggleFilter: (filterId: string) => dispatch({ type: 'toggleFilter', filterId }),
      setSort: (sortId: string | null) => dispatch({ type: 'setSort', sort: sortId }),
      setActiveItem: (id: string | null) => {
        uiStore.setActiveId(id)
        dispatch({ type: 'setActiveItem', id })
      },
      selectItem: (id: string) => {
        uiStore.setActiveId(id)
        if (!isSelectedControlled) {
          uiStore.setSelectedId(id)
          dispatch({ type: 'selectItem', id })
        } else {
          dispatch({ type: 'setActiveItem', id })
        }
        onSelectItem?.(id)
      },
      startRename: (id: string) => {
        uiStore.setRenamingId(id)
        dispatch({ type: 'startRename', id })
      },
      commitRename: (id: string, name: string) => {
        onRenameItem?.(id, name)
        uiStore.setRenamingId(null)
        dispatch({ type: 'cancelRename' })
      },
      cancelRename: () => {
        uiStore.setRenamingId(null)
        dispatch({ type: 'cancelRename' })
      },
      openContextMenu: (id: string) => onOpenContextMenu?.(id),
      selectGroupHeaderItem: (id: string) => {
        if (!isSelectedControlled) {
          uiStore.setSelectedId(id)
          dispatch({ type: 'selectItem', id })
        }
        const handleSelect = onGroupHeaderSelectItem ?? onSelectItem
        handleSelect?.(id)
      },
      showMoreInGroup: (groupId: string) => dispatch({ type: 'showMoreInGroup', groupId }),
      collapseGroupItems: (groupId: string) =>
        dispatch({ type: 'collapseGroupItems', groupId, defaultCount: defaultGroupVisibleCount }),
      expandGroups: (groupIds: readonly string[]) => {
        if (isControlled) {
          const removeSet = new Set(groupIds)
          notifyControlledCollapsedStateChange(collapsedStateRef.current.filter((id) => !removeSet.has(id)))
          return
        }

        dispatch({ type: 'expandGroups', groupIds })
      },
      collapseGroups: (groupIds: readonly string[]) => {
        if (isControlled) {
          dispatch({ type: 'resetGroupVisibleCounts', groupIds, defaultCount: defaultGroupVisibleCount })
          notifyControlledCollapsedStateChange([...collapsedStateRef.current, ...groupIds])
          return
        }

        dispatch({ type: 'collapseGroups', groupIds, defaultCount: defaultGroupVisibleCount })
      },
      toggleGroup: (groupId: string) => {
        if (isControlled) {
          const nextCollapsedIds = collapsedStateRef.current.includes(groupId)
            ? collapsedStateRef.current.filter((id) => id !== groupId)
            : [...collapsedStateRef.current, groupId]
          notifyControlledCollapsedStateChange(nextCollapsedIds)
          return
        }

        dispatch({ type: 'toggleGroup', groupId })
      },
      reorder: (payload: ResourceListReorderPayload) => onReorder?.(payload)
    }),
    [
      defaultGroupVisibleCount,
      isControlled,
      isSelectedControlled,
      notifyControlledCollapsedStateChange,
      onGroupHeaderSelectItem,
      onOpenContextMenu,
      onRenameItem,
      onReorder,
      onSelectItem,
      uiStore
    ]
  )

  const controlsState = useMemo<ResourceListControlsState>(
    () => ({
      filters: state.filters,
      query: state.query,
      sort: state.sort,
      status
    }),
    [state.filters, state.query, state.sort, status]
  )

  const itemAccessors = useMemo<ResourceListItemAccessors<T>>(
    () => ({
      getItemId,
      getItemLabel
    }),
    [getItemId, getItemLabel]
  )

  const meta = useMemo<ResourceListMeta<T>>(
    () => ({
      variant,
      getItemId,
      getItemLabel,
      groups: viewGroups.map((group) => group.group),
      sections: viewSections.map((section) => section.section),
      getSectionHeaderAction,
      getGroupHeaderAction,
      getGroupHeaderContextMenu,
      getGroupHeaderLeadingAction,
      getGroupHeaderIcon,
      getGroupHeaderClassName,
      getGroupHeaderTooltip,
      getGroupHeaderClickBehavior,
      onEmptyGroupHeaderClick,
      sortOptions,
      filterOptions,
      estimateItemSize,
      defaultGroupVisibleCount,
      groupLoadStep,
      groupShowMoreLabel,
      groupCollapseLabel,
      revealRequest,
      dragCapabilities: {
        groups: false,
        items: true,
        itemSameGroup: true,
        itemCrossGroup: false,
        ...dragCapabilities
      },
      canDragGroup,
      canDragItem,
      canDropGroup,
      canDropItem
    }),
    [
      canDragGroup,
      canDragItem,
      canDropGroup,
      canDropItem,
      defaultGroupVisibleCount,
      dragCapabilities,
      estimateItemSize,
      filterOptions,
      getSectionHeaderAction,
      getGroupHeaderAction,
      getGroupHeaderClassName,
      getGroupHeaderClickBehavior,
      getGroupHeaderContextMenu,
      getGroupHeaderIcon,
      getGroupHeaderLeadingAction,
      getGroupHeaderTooltip,
      getItemId,
      getItemLabel,
      groupCollapseLabel,
      groupLoadStep,
      groupShowMoreLabel,
      onEmptyGroupHeaderClick,
      revealRequest,
      sortOptions,
      variant,
      viewGroups,
      viewSections
    ]
  )

  const view = useMemo<ResourceListView<T>>(
    () => ({
      items: viewItems,
      visibleItems,
      groups: viewGroups,
      sections: viewSections
    }),
    [viewGroups, viewItems, viewSections, visibleItems]
  )

  const legacyState = useMemo<ResourceListState>(
    () => ({
      ...state,
      collapsedGroups: [
        ...viewSections.filter((section) => section.collapsed).map((section) => section.section.id),
        ...viewGroups.filter((group) => group.collapsed).map((group) => group.group.id)
      ],
      selectedId: effectiveSelectedId,
      status
    }),
    [effectiveSelectedId, state, status, viewGroups, viewSections]
  )

  const context = useMemo<ResourceListContextValue<T>>(
    () => ({
      state: legacyState,
      actions,
      meta,
      sourceItems: items,
      view
    }),
    [actions, items, legacyState, meta, view]
  )

  return (
    <ResourceListUiStoreContext value={uiStore}>
      <ResourceListActionsContext value={actions}>
        <ResourceListItemAccessorsContext
          value={itemAccessors as unknown as ResourceListItemAccessors<ResourceListItemBase>}>
          <ResourceListMetaContext value={meta as unknown as ResourceListMeta<ResourceListItemBase>}>
            <ResourceListSourceItemsContext value={items}>
              <ResourceListViewContext value={view as unknown as ResourceListView<ResourceListItemBase>}>
                <ResourceListControlsContext value={controlsState}>
                  <ResourceListContext value={context as unknown as ResourceListContextValue<ResourceListItemBase>}>
                    {children}
                  </ResourceListContext>
                </ResourceListControlsContext>
              </ResourceListViewContext>
            </ResourceListSourceItemsContext>
          </ResourceListMetaContext>
        </ResourceListItemAccessorsContext>
      </ResourceListActionsContext>
    </ResourceListUiStoreContext>
  )
}

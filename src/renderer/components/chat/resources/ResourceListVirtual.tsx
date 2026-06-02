import {
  buildGroupedVirtualRows,
  type DynamicVirtualListRef,
  GroupedSortableVirtualList,
  type GroupedSortableVirtualListDragPayload,
  GroupedVirtualList,
  type GroupedVirtualListGroup,
  type GroupedVirtualListRow
} from '@renderer/components/VirtualList'
import { cn } from '@renderer/utils/style'
import type { ReactNode, Ref, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type ResourceListContextValue,
  type ResourceListGroup,
  type ResourceListItemBase,
  type ResourceListSection,
  useResourceListActions,
  useResourceListControlsState,
  useResourceListMeta,
  useResourceListSourceItems,
  useResourceListUiStore,
  useResourceListView
} from './ResourceListContext'
import {
  GroupHeader,
  GroupShowMore,
  ResourceListGroupHeaderContextMenuOwner,
  SectionHeader
} from './ResourceListGroups'
import { RESOURCE_LIST_DEFAULT_ROW_SIZE, RESOURCE_LIST_ROW_HEIGHT_CLASS } from './resourceListLayout'

const SCROLLBAR_AUTO_HIDE_DELAY = 1200
const SCROLLBAR_FADE_STEP = 140
const ITEM_ROW_CLASS = `flex w-full items-center py-[2px] ${RESOURCE_LIST_ROW_HEIGHT_CLASS}`

type ScrollbarStage = 'active' | 'fade-1' | 'fade-2' | 'fade-3' | 'idle'

const SCROLLBAR_THUMB_CLASS_BY_STAGE: Record<ScrollbarStage, string> = {
  active:
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,var(--color-scrollbar-thumb)_0%,var(--color-scrollbar-thumb)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_55%,transparent)_72%,transparent_100%)]',
  'fade-1':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_70%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_70%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_35%,transparent)_72%,transparent_100%)]',
  'fade-2':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_40%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_40%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_20%,transparent)_72%,transparent_100%)]',
  'fade-3':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_16%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_16%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_8%,transparent)_72%,transparent_100%)]',
  idle: '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,transparent_0%,transparent_50%,transparent_100%)]'
}

const SCROLLBAR_COLOR_BY_STAGE: Record<ScrollbarStage, string> = {
  active: 'var(--color-scrollbar-thumb) transparent',
  'fade-1': 'color-mix(in srgb, var(--color-scrollbar-thumb) 70%, transparent) transparent',
  'fade-2': 'color-mix(in srgb, var(--color-scrollbar-thumb) 40%, transparent) transparent',
  'fade-3': 'color-mix(in srgb, var(--color-scrollbar-thumb) 16%, transparent) transparent',
  idle: 'transparent transparent'
}

export type VirtualItemsProps<T extends ResourceListItemBase> = {
  className?: string
  ref?: Ref<HTMLDivElement>
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
}

type ResourceListVirtualItem<T extends ResourceListItemBase> = {
  item: T
  itemIndex: number
}

type ResourceListVirtualFooter = {
  groupId: string
}

type ResourceListVirtualGroupData = ResourceListGroup & {
  __resourceListKind?: 'section'
}

type ResourceListVirtualHeader =
  | {
      type: 'group'
      group: ResourceListGroup
    }
  | {
      type: 'section'
      section: ResourceListSection
    }

type ResourceListVirtualGroup<T extends ResourceListItemBase> = GroupedVirtualListGroup<
  ResourceListVirtualGroupData,
  ResourceListVirtualItem<T>,
  ResourceListVirtualHeader,
  ResourceListVirtualFooter
>

type ResourceListVirtualRow<T extends ResourceListItemBase> = GroupedVirtualListRow<
  ResourceListVirtualGroupData,
  ResourceListVirtualItem<T>,
  ResourceListVirtualHeader,
  ResourceListVirtualFooter
>

const estimateResourceListChromeSize = () => RESOURCE_LIST_DEFAULT_ROW_SIZE

function toSectionVirtualGroup(section: ResourceListSection): ResourceListVirtualGroupData {
  return { ...section, __resourceListKind: 'section' }
}

function isSectionVirtualGroup(group: ResourceListVirtualGroupData) {
  return group.__resourceListKind === 'section'
}

function useAutoHideScrollbar(delay = SCROLLBAR_AUTO_HIDE_DELAY) {
  const [stage, setStage] = useState<ScrollbarStage>('idle')
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearScrollingTimeout = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout)
    timeoutRefs.current = []
  }, [])

  const handleScroll = useCallback(() => {
    clearScrollingTimeout()
    setStage('active')
    timeoutRefs.current = [
      setTimeout(() => setStage('fade-1'), delay),
      setTimeout(() => setStage('fade-2'), delay + SCROLLBAR_FADE_STEP),
      setTimeout(() => setStage('fade-3'), delay + SCROLLBAR_FADE_STEP * 2),
      setTimeout(() => setStage('idle'), delay + SCROLLBAR_FADE_STEP * 3)
    ]
  }, [clearScrollingTimeout, delay])

  useEffect(() => clearScrollingTimeout, [clearScrollingTimeout])

  return { stage, handleScroll }
}

function getListViewportClassName(stage: ScrollbarStage, className?: string) {
  return cn(
    'min-h-0 flex-1 overflow-auto px-1.5 py-1.5 pt-0 [scrollbar-gutter:stable]',
    '[&::-webkit-scrollbar-thumb:hover]:bg-[var(--color-scrollbar-thumb-hover)]',
    '[&::-webkit-scrollbar-thumb]:transition-[background] [&::-webkit-scrollbar-thumb]:duration-150 [&::-webkit-scrollbar-thumb]:ease-out',
    SCROLLBAR_THUMB_CLASS_BY_STAGE[stage],
    className
  )
}

function VirtualItemRow({ children }: { children: ReactNode }) {
  return (
    <div data-resource-list-item-row="true" className={ITEM_ROW_CLASS}>
      {children}
    </div>
  )
}

function buildVirtualGroups<T extends ResourceListItemBase>(view: ResourceListContextValue<T>['view']) {
  const groups: ResourceListVirtualGroup<T>[] = []
  let itemIndex = 0

  const appendGroup = (group: ResourceListContextValue<T>['view']['groups'][number]) => {
    const items: ResourceListVirtualItem<T>[] = []

    for (const item of group.items) {
      items.push({ item, itemIndex })
      itemIndex += 1
    }

    groups.push({
      group: group.group,
      header: group.group.label ? { type: 'group', group: group.group } : undefined,
      items,
      footer: group.hasMore || group.canCollapseToDefault ? { groupId: group.group.id } : undefined
    })
  }

  if (view.sections.length > 0) {
    for (const section of view.sections) {
      groups.push({
        group: toSectionVirtualGroup(section.section),
        header: { type: 'section', section: section.section },
        items: []
      })

      if (section.collapsed) continue

      for (const group of section.groups) {
        appendGroup(group)
      }
    }
    return groups
  }

  for (const group of view.groups) {
    appendGroup(group)
  }

  return groups
}

function getResourceListVirtualRowKey<T extends ResourceListItemBase>(
  row: ResourceListVirtualRow<T>,
  getItemId: (item: T) => string
) {
  if (row.type === 'group-header') return `group-header:${row.group.id}`
  if (row.type === 'group-footer') return `group-footer:${row.group.id}`
  return `item:${getItemId(row.item.item)}`
}

function getRevealRowIndex<T extends ResourceListItemBase>(
  groups: ResourceListVirtualGroup<T>[],
  itemId: string,
  getItemId: (item: T) => string
) {
  const rows = buildGroupedVirtualRows(groups, true, true)
  return rows.findIndex((row) => row.type === 'item' && getItemId(row.item.item) === itemId)
}

function useRevealRequestScroll<T extends ResourceListItemBase>(
  getItemId: (item: T) => string,
  groups: ResourceListVirtualGroup<T>[],
  revealRequest: ResourceListContextValue<T>['meta']['revealRequest'],
  virtualListRef: RefObject<DynamicVirtualListRef | null>
) {
  const scrolledRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (!revealRequest) return

    const requestKey = `${revealRequest.requestId}:${revealRequest.itemId}`
    if (scrolledRequestRef.current === requestKey) return

    const rowIndex = getRevealRowIndex(groups, revealRequest.itemId, getItemId)
    if (rowIndex < 0) return

    scrolledRequestRef.current = requestKey
    virtualListRef.current?.scrollToIndex(rowIndex, { align: 'center' })
  }, [getItemId, groups, revealRequest, virtualListRef])
}

function useResourceListRenderContext<T extends ResourceListItemBase>(): ResourceListContextValue<T> {
  const actions = useResourceListActions()
  const controls = useResourceListControlsState()
  const meta = useResourceListMeta<T>()
  const sourceItems = useResourceListSourceItems<T>()
  const store = useResourceListUiStore()
  const view = useResourceListView<T>()

  return useMemo(() => {
    return {
      actions,
      meta,
      sourceItems,
      state: {
        filters: controls.filters,
        query: controls.query,
        sort: controls.sort,
        status: controls.status,
        get collapsedGroups() {
          return [
            ...view.sections.filter((section) => section.collapsed).map((section) => section.section.id),
            ...view.groups.filter((group) => group.collapsed).map((group) => group.group.id)
          ]
        },
        get draggingId() {
          return store.getUiSnapshot().draggingId
        },
        get groupVisibleCounts() {
          return Object.fromEntries(view.groups.map((group) => [group.group.id, group.visibleCount])) as Record<
            string,
            number
          >
        },
        get hoveredId() {
          return store.getUiSnapshot().hoveredId
        },
        get renamingId() {
          return store.getUiSnapshot().renamingId
        },
        get revealFocus() {
          return store.getUiSnapshot().revealFocus
        },
        get selectedId() {
          return store.getUiSnapshot().selectedId
        }
      },
      view
    }
  }, [actions, controls, meta, sourceItems, store, view])
}

export function VirtualItems<T extends ResourceListItemBase>({ className, ref, renderItem }: VirtualItemsProps<T>) {
  const meta = useResourceListMeta<T>()
  const { estimateItemSize, getItemId, revealRequest } = meta
  const view = useResourceListView<T>()
  const renderContext = useResourceListRenderContext<T>()
  const groups = useMemo(() => buildVirtualGroups(view), [view])
  const virtualRows = useMemo(() => buildGroupedVirtualRows(groups, true, true), [groups])
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const { stage, handleScroll } = useAutoHideScrollbar()
  const isScrolling = stage !== 'idle'
  const estimateVirtualItemSize = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => estimateItemSize(virtualItem.itemIndex),
    [estimateItemSize]
  )
  const renderGroupHeader = useCallback(
    (header: ResourceListVirtualHeader, _group: ResourceListVirtualGroupData) =>
      header.type === 'section' ? <SectionHeader section={header.section} /> : <GroupHeader group={header.group} />,
    []
  )
  const renderVirtualItem = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => (
      <VirtualItemRow>
        <div className="w-full">{renderItem(virtualItem.item, renderContext)}</div>
      </VirtualItemRow>
    ),
    [renderContext, renderItem]
  )
  const renderGroupFooter = useCallback(
    (footer: ResourceListVirtualFooter) => (
      <div>
        <GroupShowMore groupId={footer.groupId} />
      </div>
    ),
    []
  )
  const getVirtualRowKey = useCallback(
    (index: number) => {
      const row = virtualRows[index]
      return row ? getResourceListVirtualRowKey(row, getItemId) : index
    },
    [getItemId, virtualRows]
  )
  useRevealRequestScroll(getItemId, groups, revealRequest, virtualListRef)

  return (
    <ResourceListGroupHeaderContextMenuOwner>
      <GroupedVirtualList
        ref={virtualListRef}
        scrollElementRef={ref}
        role="listbox"
        groups={groups}
        className={getListViewportClassName(stage, className)}
        scrollerProps={{ 'data-scrolling': isScrolling ? 'true' : 'false' }}
        scrollerStyle={{ scrollbarColor: SCROLLBAR_COLOR_BY_STAGE[stage] }}
        getItemKey={getVirtualRowKey}
        onScroll={handleScroll}
        overscan={6}
        estimateGroupHeaderSize={estimateResourceListChromeSize}
        estimateItemSize={estimateVirtualItemSize}
        estimateGroupFooterSize={estimateResourceListChromeSize}
        renderGroupHeader={renderGroupHeader}
        renderItem={renderVirtualItem}
        renderGroupFooter={renderGroupFooter}
      />
    </ResourceListGroupHeaderContextMenuOwner>
  )
}

export type VirtualDraggableItemsProps<T extends ResourceListItemBase> = {
  className?: string
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
  ref?: Ref<HTMLDivElement>
}

export function VirtualDraggableItems<T extends ResourceListItemBase>({
  className,
  ref,
  renderItem
}: VirtualDraggableItemsProps<T>) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta<T>()
  const {
    canDragGroup: canDragGroupMeta,
    canDragItem: canDragItemMeta,
    canDropGroup: canDropGroupMeta,
    canDropItem: canDropItemMeta,
    dragCapabilities,
    estimateItemSize,
    getItemId,
    revealRequest
  } = meta
  const view = useResourceListView<T>()
  const renderContext = useResourceListRenderContext<T>()
  const groups = useMemo(() => buildVirtualGroups(view), [view])
  const virtualRows = useMemo(() => buildGroupedVirtualRows(groups, true, true), [groups])
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const { stage, handleScroll } = useAutoHideScrollbar()
  const isScrolling = stage !== 'idle'
  const getGroupId = useCallback((group: ResourceListVirtualGroupData) => group.id, [])
  const getVirtualItemId = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => getItemId(virtualItem.item),
    [getItemId]
  )
  const estimateVirtualItemSize = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => estimateItemSize(virtualItem.itemIndex),
    [estimateItemSize]
  )
  const handleGroupedDragEnd = useCallback(
    (payload: GroupedSortableVirtualListDragPayload<ResourceListVirtualGroupData, ResourceListVirtualItem<T>>) => {
      if (payload.type === 'group') {
        actions.reorder({
          type: 'group',
          activeGroupId: String(payload.activeGroupId),
          overGroupId: String(payload.overGroupId),
          overType: payload.overType,
          sourceIndex: payload.sourceIndex,
          targetIndex: payload.targetIndex
        })
        return
      }

      if (payload.overType === 'item' && payload.activeId === payload.overId) return
      actions.reorder({
        type: 'item',
        activeId: String(payload.activeId),
        overId: String(payload.overId),
        position: payload.position,
        overType: payload.overType,
        sourceGroupId: String(payload.sourceGroupId),
        targetGroupId: String(payload.targetGroupId),
        sourceIndex: payload.sourceIndex,
        targetIndex: payload.targetIndex
      })
    },
    [actions]
  )
  const canDragGroup = useCallback(
    (group: ResourceListVirtualGroupData, groupIndex: number) =>
      !isSectionVirtualGroup(group) && (canDragGroupMeta?.(group, groupIndex) ?? true),
    [canDragGroupMeta]
  )
  const canDragVirtualItem = useCallback(
    (
      virtualItem: ResourceListVirtualItem<T>,
      _itemIndex: number,
      group: ResourceListVirtualGroupData,
      groupIndex: number,
      itemIndexInGroup: number
    ) =>
      canDragItemMeta?.({
        item: virtualItem.item,
        itemIndex: virtualItem.itemIndex,
        group,
        groupIndex,
        itemIndexInGroup
      }) ?? true,
    [canDragItemMeta]
  )
  const canDropGroup = useCallback(
    (payload: {
      activeGroup: ResourceListVirtualGroupData
      activeGroupId: string | number
      overGroup: ResourceListVirtualGroupData
      overGroupId: string | number
      overType: 'group' | 'item'
      sourceIndex?: number
      targetIndex?: number
    }) => {
      if (isSectionVirtualGroup(payload.activeGroup) || isSectionVirtualGroup(payload.overGroup)) return false

      return (
        canDropGroupMeta?.({
          activeGroupId: String(payload.activeGroupId),
          overGroupId: String(payload.overGroupId),
          overType: payload.overType,
          sourceIndex: payload.sourceIndex ?? -1,
          targetIndex: payload.targetIndex ?? -1
        }) ?? true
      )
    },
    [canDropGroupMeta]
  )
  const canDropVirtualItem = useCallback(
    (payload: {
      activeId: string | number
      activeItem: ResourceListVirtualItem<T>
      overGroup: ResourceListVirtualGroupData
      overGroupId: string | number
      overId: string | number
      overItem?: ResourceListVirtualItem<T>
      overType: 'group' | 'item'
      sourceGroup: ResourceListVirtualGroupData
      sourceGroupId: string | number
      sourceIndex: number
      targetIndex: number
    }) => {
      if (isSectionVirtualGroup(payload.sourceGroup) || isSectionVirtualGroup(payload.overGroup)) return false

      return (
        canDropItemMeta?.({
          activeId: String(payload.activeId),
          activeItem: payload.activeItem.item,
          overId: String(payload.overId),
          overItem: payload.overItem?.item,
          overType: payload.overType,
          sourceGroup: payload.sourceGroup,
          sourceGroupId: String(payload.sourceGroupId),
          sourceIndex: payload.sourceIndex,
          targetGroup: payload.overGroup,
          targetGroupId: String(payload.overGroupId),
          targetIndex: payload.targetIndex
        }) ?? true
      )
    },
    [canDropItemMeta]
  )
  const renderGroupHeader = useCallback(
    (header: ResourceListVirtualHeader, _group: ResourceListVirtualGroupData) =>
      header.type === 'section' ? <SectionHeader section={header.section} /> : <GroupHeader group={header.group} />,
    []
  )
  const renderVirtualItem = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => (
      <VirtualItemRow>
        <div className="w-full">{renderItem(virtualItem.item, renderContext)}</div>
      </VirtualItemRow>
    ),
    [renderContext, renderItem]
  )
  const renderGroupFooter = useCallback(
    (footer: ResourceListVirtualFooter) => (
      <div>
        <GroupShowMore groupId={footer.groupId} />
      </div>
    ),
    []
  )
  const getVirtualRowKey = useCallback(
    (index: number) => {
      const row = virtualRows[index]
      return row ? getResourceListVirtualRowKey(row, getItemId) : index
    },
    [getItemId, virtualRows]
  )
  useRevealRequestScroll(getItemId, groups, revealRequest, virtualListRef)

  return (
    <ResourceListGroupHeaderContextMenuOwner>
      <GroupedSortableVirtualList
        ref={virtualListRef}
        scrollElementRef={ref}
        role="listbox"
        groups={groups}
        className={getListViewportClassName(stage, className)}
        scrollerProps={{ 'data-scrolling': isScrolling ? 'true' : 'false' }}
        scrollerStyle={{ scrollbarColor: SCROLLBAR_COLOR_BY_STAGE[stage] }}
        getItemKey={getVirtualRowKey}
        onScroll={handleScroll}
        overscan={6}
        getGroupId={getGroupId}
        getItemId={getVirtualItemId}
        dragCapabilities={dragCapabilities}
        estimateGroupHeaderSize={estimateResourceListChromeSize}
        estimateItemSize={estimateVirtualItemSize}
        estimateGroupFooterSize={estimateResourceListChromeSize}
        canDragGroup={canDragGroup}
        canDragItem={canDragVirtualItem}
        canDropGroup={canDropGroup}
        canDropItem={canDropVirtualItem}
        onDragEnd={handleGroupedDragEnd}
        renderGroupHeader={renderGroupHeader}
        renderItem={renderVirtualItem}
        renderGroupFooter={renderGroupFooter}
      />
    </ResourceListGroupHeaderContextMenuOwner>
  )
}

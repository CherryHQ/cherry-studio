import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core'
import { DndContext, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type React from 'react'
import { memo, useCallback, useMemo } from 'react'

import DynamicVirtualList, { type DynamicVirtualListProps } from './dynamic'
import { buildGroupedVirtualRows, type GroupedVirtualListGroup, type GroupedVirtualListRow } from './grouped'

type GroupedSortableVirtualListRow<TGroup, TItem, THeader, TFooter> = GroupedVirtualListRow<
  TGroup,
  TItem,
  THeader,
  TFooter
>

type BaseDynamicVirtualListProps<TGroup, TItem, THeader, TFooter> = Omit<
  DynamicVirtualListProps<GroupedSortableVirtualListRow<TGroup, TItem, THeader, TFooter>>,
  'children' | 'estimateSize' | 'list'
>

type DragDataBase<TGroup> = {
  group: TGroup
  groupId: UniqueIdentifier
  groupIndex: number
}

type ItemDragData<TGroup, TItem> = DragDataBase<TGroup> & {
  item: TItem
  itemId: UniqueIdentifier
  itemIndex: number
  itemIndexInGroup: number
  rowType: 'item'
}

type GroupDragData<TGroup> = DragDataBase<TGroup> & {
  rowType: 'group'
}

type RowDragData<TGroup, TItem> = GroupDragData<TGroup> | ItemDragData<TGroup, TItem>

export type GroupedSortableVirtualListItemDragPayload<TGroup, TItem> = {
  type: 'item'
  activeId: UniqueIdentifier
  activeItem: TItem
  overId: UniqueIdentifier
  overItem?: TItem
  overType: 'group' | 'item'
  sourceGroup: TGroup
  sourceGroupId: UniqueIdentifier
  sourceIndex: number
  targetGroup: TGroup
  targetGroupId: UniqueIdentifier
  targetIndex: number
}

export type GroupedSortableVirtualListGroupDragPayload<TGroup, TItem = unknown> = {
  type: 'group'
  activeGroup: TGroup
  activeGroupId: UniqueIdentifier
  overGroup: TGroup
  overGroupId: UniqueIdentifier
  overItem?: TItem
  overType: 'group' | 'item'
  sourceIndex: number
  targetIndex: number
}

export type GroupedSortableVirtualListDragPayload<TGroup, TItem> =
  | GroupedSortableVirtualListGroupDragPayload<TGroup, TItem>
  | GroupedSortableVirtualListItemDragPayload<TGroup, TItem>

export type GroupedSortableVirtualListDragStartPayload<TGroup, TItem> =
  | {
      type: 'group'
      activeGroup: TGroup
      activeGroupId: UniqueIdentifier
      sourceIndex: number
    }
  | {
      type: 'item'
      activeId: UniqueIdentifier
      activeItem: TItem
      sourceGroup: TGroup
      sourceGroupId: UniqueIdentifier
      sourceIndex: number
    }

type CanDropGroupArgs<TGroup, TItem> = {
  activeGroup: TGroup
  activeGroupId: UniqueIdentifier
  overGroup: TGroup
  overGroupId: UniqueIdentifier
  overItem?: TItem
  overType: 'group' | 'item'
  sourceIndex: number
  targetIndex: number
}

type CanDropItemArgs<TGroup, TItem> = {
  activeId: UniqueIdentifier
  activeItem: TItem
  overGroup: TGroup
  overGroupId: UniqueIdentifier
  overId: UniqueIdentifier
  overItem?: TItem
  overType: 'group' | 'item'
  sourceGroup: TGroup
  sourceGroupId: UniqueIdentifier
  sourceIndex: number
  targetIndex: number
}

export type GroupedSortableVirtualListDragCapabilities = {
  groups?: boolean
  items?: boolean
  itemSameGroup?: boolean
  itemCrossGroup?: boolean
}

export interface GroupedSortableVirtualListProps<TGroup, TItem, THeader = TGroup, TFooter = unknown>
  extends BaseDynamicVirtualListProps<TGroup, TItem, THeader, TFooter> {
  groups: readonly GroupedVirtualListGroup<TGroup, TItem, THeader, TFooter>[]
  getGroupId: (group: TGroup, groupIndex: number) => UniqueIdentifier
  getItemId: (
    item: TItem,
    itemIndex: number,
    group: TGroup,
    groupIndex: number,
    itemIndexInGroup: number
  ) => UniqueIdentifier
  renderGroupHeader?: (header: THeader, group: TGroup, groupIndex: number) => React.ReactNode
  renderItem: (
    item: TItem,
    itemIndex: number,
    group: TGroup,
    groupIndex: number,
    itemIndexInGroup: number
  ) => React.ReactNode
  renderGroupFooter?: (footer: TFooter, group: TGroup, groupIndex: number) => React.ReactNode
  estimateGroupHeaderSize?: (header: THeader, group: TGroup, groupIndex: number) => number
  estimateItemSize: (
    item: TItem,
    itemIndex: number,
    group: TGroup,
    groupIndex: number,
    itemIndexInGroup: number
  ) => number
  estimateGroupFooterSize?: (footer: TFooter, group: TGroup, groupIndex: number) => number
  disabled?: boolean
  dragActivationDistance?: number
  dragCapabilities?: GroupedSortableVirtualListDragCapabilities
  canDragGroup?: (group: TGroup, groupIndex: number) => boolean
  canDragItem?: (item: TItem, itemIndex: number, group: TGroup, groupIndex: number, itemIndexInGroup: number) => boolean
  canDropGroup?: (args: CanDropGroupArgs<TGroup, TItem>) => boolean
  canDropItem?: (args: CanDropItemArgs<TGroup, TItem>) => boolean
  onDragStart?: (payload: GroupedSortableVirtualListDragStartPayload<TGroup, TItem>) => void
  onDragEnd?: (payload: GroupedSortableVirtualListDragPayload<TGroup, TItem>) => void
}

const DEFAULT_GROUP_HEADER_SIZE = 32
const DEFAULT_GROUP_FOOTER_SIZE = 32
const DEFAULT_DRAG_CAPABILITIES: Required<GroupedSortableVirtualListDragCapabilities> = {
  groups: false,
  items: true,
  itemSameGroup: true,
  itemCrossGroup: true
}

function toItemSortableId(id: UniqueIdentifier) {
  return `item:${String(id)}`
}

function toGroupSortableId(id: UniqueIdentifier) {
  return `group:${String(id)}`
}

function getEventData<TGroup, TItem>(data: unknown): RowDragData<TGroup, TItem> | null {
  if (!data || typeof data !== 'object') return null
  const rowData = data as Partial<RowDragData<TGroup, TItem>>
  return rowData.rowType === 'group' || rowData.rowType === 'item' ? (rowData as RowDragData<TGroup, TItem>) : null
}

function isItemDragData<TGroup, TItem>(data: RowDragData<TGroup, TItem>): data is ItemDragData<TGroup, TItem> {
  return data.rowType === 'item'
}

function buildDragStartPayload<TGroup, TItem>(
  active: RowDragData<TGroup, TItem>
): GroupedSortableVirtualListDragStartPayload<TGroup, TItem> {
  if (isItemDragData(active)) {
    return {
      type: 'item',
      activeId: active.itemId,
      activeItem: active.item,
      sourceGroup: active.group,
      sourceGroupId: active.groupId,
      sourceIndex: active.itemIndexInGroup
    }
  }

  return {
    type: 'group',
    activeGroup: active.group,
    activeGroupId: active.groupId,
    sourceIndex: active.groupIndex
  }
}

function buildDragEndPayload<TGroup, TItem>(
  active: RowDragData<TGroup, TItem>,
  over: RowDragData<TGroup, TItem>
): GroupedSortableVirtualListDragPayload<TGroup, TItem> | null {
  if (isItemDragData(active)) {
    const overItem = isItemDragData(over) ? over.item : undefined
    return {
      type: 'item',
      activeId: active.itemId,
      activeItem: active.item,
      overId: isItemDragData(over) ? over.itemId : over.groupId,
      overItem,
      overType: over.rowType,
      sourceGroup: active.group,
      sourceGroupId: active.groupId,
      sourceIndex: active.itemIndexInGroup,
      targetGroup: over.group,
      targetGroupId: over.groupId,
      targetIndex: isItemDragData(over) ? over.itemIndexInGroup : 0
    }
  }

  if (active.groupId === over.groupId) return null

  return {
    type: 'group',
    activeGroup: active.group,
    activeGroupId: active.groupId,
    overGroup: over.group,
    overGroupId: over.groupId,
    overItem: isItemDragData(over) ? over.item : undefined,
    overType: over.rowType,
    sourceIndex: active.groupIndex,
    targetIndex: over.groupIndex
  }
}

function shouldDropPayload<TGroup, TItem>(
  payload: GroupedSortableVirtualListDragPayload<TGroup, TItem>,
  dragCapabilities: Required<GroupedSortableVirtualListDragCapabilities>,
  canDropGroup?: (args: CanDropGroupArgs<TGroup, TItem>) => boolean,
  canDropItem?: (args: CanDropItemArgs<TGroup, TItem>) => boolean
) {
  if (payload.type === 'group') {
    if (!dragCapabilities.groups) return false
    return (
      canDropGroup?.({
        activeGroup: payload.activeGroup,
        activeGroupId: payload.activeGroupId,
        overGroup: payload.overGroup,
        overGroupId: payload.overGroupId,
        overItem: payload.overItem,
        overType: payload.overType,
        sourceIndex: payload.sourceIndex,
        targetIndex: payload.targetIndex
      }) ?? true
    )
  }

  if (!dragCapabilities.items) return false
  const isSameGroup = payload.sourceGroupId === payload.targetGroupId
  if (isSameGroup && !dragCapabilities.itemSameGroup) return false
  if (!isSameGroup && !dragCapabilities.itemCrossGroup) return false

  return (
    canDropItem?.({
      activeId: payload.activeId,
      activeItem: payload.activeItem,
      overGroup: payload.targetGroup,
      overGroupId: payload.targetGroupId,
      overId: payload.overId,
      overItem: payload.overItem,
      overType: payload.overType,
      sourceGroup: payload.sourceGroup,
      sourceGroupId: payload.sourceGroupId,
      sourceIndex: payload.sourceIndex,
      targetIndex: payload.targetIndex
    }) ?? true
  )
}

type SortableItemRowProps<TGroup, TItem> = {
  children: React.ReactNode
  data: ItemDragData<TGroup, TItem>
  disabled: boolean
}

function SortableItemRow<TGroup, TItem>({ children, data, disabled }: SortableItemRowProps<TGroup, TItem>) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: toItemSortableId(data.itemId),
    data,
    disabled
  })

  return (
    <div
      ref={setNodeRef}
      data-dragging={isDragging || undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      {...attributes}
      {...listeners}>
      {children}
    </div>
  )
}

type GroupHeaderRowProps<TGroup> = {
  children: React.ReactNode
  data: GroupDragData<TGroup>
  draggable: boolean
  disabled: boolean
}

function GroupHeaderRow<TGroup>({ children, data, draggable, disabled }: GroupHeaderRowProps<TGroup>) {
  if (draggable) {
    return (
      <SortableGroupHeaderRow data={data} disabled={disabled}>
        {children}
      </SortableGroupHeaderRow>
    )
  }

  return (
    <DroppableGroupHeaderRow data={data} disabled={disabled}>
      {children}
    </DroppableGroupHeaderRow>
  )
}

function SortableGroupHeaderRow<TGroup>({ children, data, disabled }: Omit<GroupHeaderRowProps<TGroup>, 'draggable'>) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: toGroupSortableId(data.groupId),
    data,
    disabled
  })

  return (
    <div
      ref={setNodeRef}
      data-dragging={isDragging || undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      {...attributes}
      {...listeners}>
      {children}
    </div>
  )
}

function DroppableGroupHeaderRow<TGroup>({ children, data, disabled }: Omit<GroupHeaderRowProps<TGroup>, 'draggable'>) {
  const { isOver, setNodeRef } = useDroppable({
    id: toGroupSortableId(data.groupId),
    data,
    disabled
  })

  return (
    <div ref={setNodeRef} data-over={isOver || undefined}>
      {children}
    </div>
  )
}

function GroupedSortableVirtualList<TGroup, TItem, THeader = TGroup, TFooter = unknown>(
  props: GroupedSortableVirtualListProps<TGroup, TItem, THeader, TFooter>
) {
  const {
    groups,
    getGroupId,
    getItemId,
    renderGroupHeader,
    renderItem,
    renderGroupFooter,
    estimateGroupHeaderSize,
    estimateItemSize,
    estimateGroupFooterSize,
    disabled = false,
    dragActivationDistance = 6,
    dragCapabilities,
    canDragGroup,
    canDragItem,
    canDropGroup,
    canDropItem,
    onDragStart,
    onDragEnd,
    ...virtualListProps
  } = props

  const effectiveDragCapabilities = useMemo(
    () => ({ ...DEFAULT_DRAG_CAPABILITIES, ...dragCapabilities }),
    [dragCapabilities]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: dragActivationDistance } }),
    useSensor(KeyboardSensor)
  )

  const rows = useMemo(
    () => buildGroupedVirtualRows(groups, Boolean(renderGroupHeader), Boolean(renderGroupFooter)),
    [groups, renderGroupFooter, renderGroupHeader]
  )

  const sortableIds = useMemo(
    () =>
      rows.flatMap((row) => {
        if (row.type === 'item') {
          return toItemSortableId(getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup))
        }

        if (
          row.type === 'group-header' &&
          effectiveDragCapabilities.groups &&
          (canDragGroup?.(row.group, row.groupIndex) ?? true)
        ) {
          return toGroupSortableId(getGroupId(row.group, row.groupIndex))
        }

        return []
      }),
    [canDragGroup, effectiveDragCapabilities.groups, getGroupId, getItemId, rows]
  )

  const estimateRowSize = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return 0

      if (row.type === 'group-header') {
        return estimateGroupHeaderSize?.(row.header, row.group, row.groupIndex) ?? DEFAULT_GROUP_HEADER_SIZE
      }

      if (row.type === 'group-footer') {
        return estimateGroupFooterSize?.(row.footer, row.group, row.groupIndex) ?? DEFAULT_GROUP_FOOTER_SIZE
      }

      return estimateItemSize(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
    },
    [estimateGroupFooterSize, estimateGroupHeaderSize, estimateItemSize, rows]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const active = getEventData<TGroup, TItem>(event.active.data.current)
      if (active) onDragStart?.(buildDragStartPayload(active))
    },
    [onDragStart]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = getEventData<TGroup, TItem>(event.active.data.current)
      const over = getEventData<TGroup, TItem>(event.over?.data.current)
      if (!active || !over) return
      if (isItemDragData(active)) {
        const canDragActiveItem =
          canDragItem?.(active.item, active.itemIndex, active.group, active.groupIndex, active.itemIndexInGroup) ?? true
        if (!canDragActiveItem) return
      } else {
        const canDragActiveGroup = canDragGroup?.(active.group, active.groupIndex) ?? true
        if (!canDragActiveGroup) return
      }

      const payload = buildDragEndPayload(active, over)
      if (!payload) return
      if (payload.type === 'item' && payload.overType === 'item' && payload.activeId === payload.overId) return
      if (!shouldDropPayload(payload, effectiveDragCapabilities, canDropGroup, canDropItem)) return

      onDragEnd?.(payload)
    },
    [canDragGroup, canDragItem, canDropGroup, canDropItem, effectiveDragCapabilities, onDragEnd]
  )

  const renderRow = useCallback(
    (row: GroupedSortableVirtualListRow<TGroup, TItem, THeader, TFooter>) => {
      if (row.type === 'group-header') {
        const groupId = getGroupId(row.group, row.groupIndex)
        const data: GroupDragData<TGroup> = {
          rowType: 'group',
          group: row.group,
          groupId,
          groupIndex: row.groupIndex
        }

        return (
          <GroupHeaderRow
            data={data}
            disabled={disabled}
            draggable={
              !disabled && effectiveDragCapabilities.groups && (canDragGroup?.(row.group, row.groupIndex) ?? true)
            }>
            {renderGroupHeader?.(row.header, row.group, row.groupIndex) ?? null}
          </GroupHeaderRow>
        )
      }

      if (row.type === 'group-footer') {
        return renderGroupFooter?.(row.footer, row.group, row.groupIndex) ?? null
      }

      const itemId = getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
      const itemDisabled =
        disabled ||
        !effectiveDragCapabilities.items ||
        !(canDragItem?.(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup) ?? true)
      const data: ItemDragData<TGroup, TItem> = {
        rowType: 'item',
        group: row.group,
        groupId: getGroupId(row.group, row.groupIndex),
        groupIndex: row.groupIndex,
        item: row.item,
        itemId,
        itemIndex: row.itemIndex,
        itemIndexInGroup: row.itemIndexInGroup
      }

      return (
        <SortableItemRow data={data} disabled={itemDisabled}>
          {renderItem(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)}
        </SortableItemRow>
      )
    },
    [
      canDragGroup,
      canDragItem,
      disabled,
      effectiveDragCapabilities.groups,
      effectiveDragCapabilities.items,
      getGroupId,
      getItemId,
      renderGroupFooter,
      renderGroupHeader,
      renderItem
    ]
  )

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <DynamicVirtualList {...virtualListProps} list={rows} estimateSize={estimateRowSize} children={renderRow} />
      </SortableContext>
    </DndContext>
  )
}

const MemoizedGroupedSortableVirtualList = memo(GroupedSortableVirtualList) as <
  TGroup,
  TItem,
  THeader = TGroup,
  TFooter = unknown
>(
  props: GroupedSortableVirtualListProps<TGroup, TItem, THeader, TFooter>
) => React.ReactElement

export default MemoizedGroupedSortableVirtualList

import type { DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { SortableContext, type SortingStrategy, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type React from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

type ActiveDragState<TGroup, TItem> = {
  active: RowDragData<TGroup, TItem>
  blockedGroupIds: Set<UniqueIdentifier>
  overlaySize?: {
    height: number
    width: number
  }
}

type OverDropState = {
  position: 'before' | 'after'
  rowType: 'group' | 'item'
  targetId: UniqueIdentifier
  targetGroupId: UniqueIdentifier
}

type DropIndicatorPosition = 'before' | 'after'

type GroupAppendIndicatorTarget = {
  itemId?: UniqueIdentifier
  position: DropIndicatorPosition
  rowType: 'group-footer' | 'group-header' | 'item'
}

type GroupBoundaryIndicatorTargets = {
  after: GroupAppendIndicatorTarget
  before: GroupAppendIndicatorTarget
}

export type GroupedSortableVirtualListItemDragPayload<TGroup, TItem> = {
  type: 'item'
  activeId: UniqueIdentifier
  activeItem: TItem
  overId: UniqueIdentifier
  overItem?: TItem
  overType: 'group' | 'item'
  position: 'before' | 'after'
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

function toGroupFooterDroppableId(id: UniqueIdentifier) {
  return `group-footer:${String(id)}`
}

function getEventData<TGroup, TItem>(data: unknown): RowDragData<TGroup, TItem> | null {
  if (!data || typeof data !== 'object') return null
  const rowData = data as Partial<RowDragData<TGroup, TItem>>
  return rowData.rowType === 'group' || rowData.rowType === 'item' ? (rowData as RowDragData<TGroup, TItem>) : null
}

function isItemDragData<TGroup, TItem>(data: RowDragData<TGroup, TItem>): data is ItemDragData<TGroup, TItem> {
  return data.rowType === 'item'
}

function joinClassNames(...classNames: Array<false | null | string | undefined>) {
  const next = classNames.filter(Boolean).join(' ')
  return next || undefined
}

function DropIndicator({ position }: { position: DropIndicatorPosition }) {
  return (
    <div
      aria-hidden="true"
      className={joinClassNames(
        'pointer-events-none absolute right-2 left-2 z-10 h-0.5 rounded-full bg-sidebar-ring',
        position === 'before' ? 'top-0' : 'bottom-0'
      )}
      data-drop-indicator={position}
    />
  )
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

function buildGroupDragData<TGroup>(
  group: TGroup,
  groupId: UniqueIdentifier,
  groupIndex: number
): GroupDragData<TGroup> {
  return {
    rowType: 'group',
    group,
    groupId,
    groupIndex
  }
}

function buildItemDragData<TGroup, TItem>({
  group,
  groupId,
  groupIndex,
  item,
  itemId,
  itemIndex,
  itemIndexInGroup
}: {
  group: TGroup
  groupId: UniqueIdentifier
  groupIndex: number
  item: TItem
  itemId: UniqueIdentifier
  itemIndex: number
  itemIndexInGroup: number
}): ItemDragData<TGroup, TItem> {
  return {
    rowType: 'item',
    group,
    groupId,
    groupIndex,
    item,
    itemId,
    itemIndex,
    itemIndexInGroup
  }
}

function buildDragEndPayload<TGroup, TItem>(
  active: RowDragData<TGroup, TItem>,
  over: RowDragData<TGroup, TItem>,
  position: 'before' | 'after'
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
      position,
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

function getRectCenterY(rect: { top: number; height: number } | null | undefined) {
  if (!rect) return null
  return rect.top + rect.height / 2
}

function getItemDropPosition<TGroup, TItem>(
  event: Pick<DragEndEvent, 'active' | 'over'>,
  active: RowDragData<TGroup, TItem>,
  over: RowDragData<TGroup, TItem>
): 'before' | 'after' {
  if (!isItemDragData(over)) return 'before'

  const activeCenterY = getRectCenterY(event.active.rect?.current?.translated ?? event.active.rect?.current?.initial)
  const overCenterY = getRectCenterY(event.over?.rect)

  if (activeCenterY !== null && overCenterY !== null) {
    return activeCenterY < overCenterY ? 'before' : 'after'
  }

  if (isItemDragData(active) && active.groupId === over.groupId && active.itemIndexInGroup > over.itemIndexInGroup) {
    return 'before'
  }

  return 'after'
}

function getDropPosition<TGroup, TItem>(
  event: Pick<DragEndEvent, 'active' | 'over'>,
  active: RowDragData<TGroup, TItem>,
  over: RowDragData<TGroup, TItem>
): 'before' | 'after' {
  if (!isItemDragData(active)) {
    return active.groupIndex < over.groupIndex ? 'after' : 'before'
  }

  return getItemDropPosition(event, active, over)
}

function buildDropPayloadFromEvent<TGroup, TItem>(event: Pick<DragEndEvent, 'active' | 'over'>) {
  const active = getEventData<TGroup, TItem>(event.active.data.current)
  const over = getEventData<TGroup, TItem>(event.over?.data.current)
  if (!active || !over) return null

  const position = getDropPosition(event, active, over)
  const payload = buildDragEndPayload(active, over, position)
  if (!payload) return null

  return { active, over, payload, position }
}

function getDropPositionFromState<TGroup, TItem>(over: RowDragData<TGroup, TItem>, dropState: OverDropState | null) {
  if (!dropState) return null

  const overTargetId = isItemDragData(over) ? over.itemId : over.groupId
  if (dropState.rowType !== over.rowType) return null
  if (dropState.targetId !== overTargetId) return null
  if (dropState.targetGroupId !== over.groupId) return null

  return dropState.position
}

function buildDropPayloadFromStateOrEvent<TGroup, TItem>(
  event: Pick<DragEndEvent, 'active' | 'over'>,
  dropState: OverDropState | null,
  groupAppendDropTargets?: Map<UniqueIdentifier, ItemDragData<TGroup, TItem>>
) {
  const active = getEventData<TGroup, TItem>(event.active.data.current)
  const over = getEventData<TGroup, TItem>(event.over?.data.current)
  if (!active || !over) return null

  const statePosition = getDropPositionFromState(over, dropState)
  const appendDropTarget =
    statePosition !== null && isItemDragData(active) && !isItemDragData(over)
      ? groupAppendDropTargets?.get(over.groupId)
      : undefined
  const payloadOver = appendDropTarget ?? over
  const position = appendDropTarget ? 'after' : (statePosition ?? getDropPosition(event, active, over))
  const payload = buildDragEndPayload(active, payloadOver, position)
  if (!payload) return null

  return { active, over: payloadOver, payload, position }
}

function getOverDropState<TGroup, TItem>(
  over: RowDragData<TGroup, TItem>,
  position: 'before' | 'after'
): OverDropState {
  return {
    position,
    rowType: over.rowType,
    targetId: isItemDragData(over) ? over.itemId : over.groupId,
    targetGroupId: over.groupId
  }
}

function isSameOverDropState(current: OverDropState | null, next: OverDropState | null) {
  return (
    current?.position === next?.position &&
    current?.rowType === next?.rowType &&
    current?.targetId === next?.targetId &&
    current?.targetGroupId === next?.targetGroupId
  )
}

function getDropTargetRowState<TGroup, TItem>({
  activeDragState,
  groupId,
  overDropState,
  rowId,
  rowType
}: {
  activeDragState: ActiveDragState<TGroup, TItem> | null
  groupId: UniqueIdentifier
  overDropState: OverDropState | null
  rowId?: UniqueIdentifier
  rowType?: 'group' | 'item'
}) {
  const isBlocked = activeDragState?.blockedGroupIds.has(groupId) ?? false
  const isAllowed =
    !isBlocked &&
    rowType !== undefined &&
    rowId !== undefined &&
    overDropState?.rowType === rowType &&
    overDropState.targetId === rowId

  return {
    isBlocked,
    props: {
      className: isBlocked ? 'cursor-not-allowed opacity-50 [&_*]:pointer-events-none' : undefined,
      'data-drop-allowed': isAllowed || undefined,
      'data-drop-blocked': isBlocked || undefined,
      'data-drop-invalid': isBlocked || undefined,
      'data-drop-target': isAllowed || undefined
    }
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
  activeDragState: ActiveDragState<TGroup, TItem> | null
  children: React.ReactNode
  data: ItemDragData<TGroup, TItem>
  disabled: boolean
  dropIndicatorPosition?: DropIndicatorPosition | null
  freezeTransform?: boolean
  overDropState: OverDropState | null
  sourcePlaceholder?: boolean
}

function SortableItemRow<TGroup, TItem>({
  activeDragState,
  children,
  data,
  disabled,
  dropIndicatorPosition,
  freezeTransform = false,
  overDropState,
  sourcePlaceholder = false
}: SortableItemRowProps<TGroup, TItem>) {
  const dropTargetRowState = getDropTargetRowState({
    activeDragState,
    groupId: data.groupId,
    overDropState,
    rowId: data.itemId,
    rowType: 'item'
  })
  const isActiveItem =
    activeDragState?.active !== undefined &&
    isItemDragData(activeDragState.active) &&
    activeDragState.active.itemId === data.itemId
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: toItemSortableId(data.itemId),
    data,
    disabled: disabled || (dropTargetRowState.isBlocked && !isActiveItem)
  })

  return (
    <div
      ref={setNodeRef}
      data-dragging={isDragging || undefined}
      {...dropTargetRowState.props}
      className={joinClassNames(dropTargetRowState.props.className, dropIndicatorPosition ? 'relative' : undefined)}
      style={{
        opacity: isDragging || sourcePlaceholder ? 0.5 : undefined,
        transform: dropTargetRowState.isBlocked || freezeTransform ? undefined : CSS.Transform.toString(transform),
        transition: dropTargetRowState.isBlocked || freezeTransform ? undefined : transition
      }}
      {...attributes}
      {...listeners}>
      {dropIndicatorPosition ? <DropIndicator position={dropIndicatorPosition} /> : null}
      {children}
    </div>
  )
}

type GroupHeaderRowProps<TGroup, TItem> = {
  activeDragState: ActiveDragState<TGroup, TItem> | null
  children: React.ReactNode
  data: GroupDragData<TGroup>
  draggable: boolean
  disabled: boolean
  dropIndicatorPosition?: DropIndicatorPosition | null
  freezeTransform?: boolean
  overDropState: OverDropState | null
  sourcePlaceholder?: boolean
}

function GroupHeaderRow<TGroup, TItem>({
  activeDragState,
  children,
  data,
  draggable,
  disabled,
  dropIndicatorPosition,
  freezeTransform,
  overDropState,
  sourcePlaceholder
}: GroupHeaderRowProps<TGroup, TItem>) {
  if (draggable) {
    return (
      <SortableGroupHeaderRow
        activeDragState={activeDragState}
        data={data}
        disabled={disabled}
        dropIndicatorPosition={dropIndicatorPosition}
        freezeTransform={freezeTransform}
        overDropState={overDropState}
        sourcePlaceholder={sourcePlaceholder}>
        {children}
      </SortableGroupHeaderRow>
    )
  }

  return (
    <DroppableGroupHeaderRow
      activeDragState={activeDragState}
      data={data}
      disabled={disabled}
      dropIndicatorPosition={dropIndicatorPosition}
      overDropState={overDropState}
      sourcePlaceholder={sourcePlaceholder}>
      {children}
    </DroppableGroupHeaderRow>
  )
}

function SortableGroupHeaderRow<TGroup, TItem>({
  activeDragState,
  children,
  data,
  disabled,
  dropIndicatorPosition,
  freezeTransform = false,
  overDropState,
  sourcePlaceholder = false
}: Omit<GroupHeaderRowProps<TGroup, TItem>, 'draggable'>) {
  const dropTargetRowState = getDropTargetRowState({
    activeDragState,
    groupId: data.groupId,
    overDropState,
    rowId: data.groupId,
    rowType: 'group'
  })
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: toGroupSortableId(data.groupId),
    data,
    disabled: disabled || dropTargetRowState.isBlocked
  })

  return (
    <div
      ref={setNodeRef}
      data-dragging={isDragging || undefined}
      {...dropTargetRowState.props}
      className={joinClassNames(dropTargetRowState.props.className, dropIndicatorPosition ? 'relative' : undefined)}
      style={{
        opacity: isDragging || sourcePlaceholder ? 0.5 : undefined,
        transform: dropTargetRowState.isBlocked || freezeTransform ? undefined : CSS.Transform.toString(transform),
        transition: dropTargetRowState.isBlocked || freezeTransform ? undefined : transition
      }}
      {...attributes}
      {...listeners}>
      {dropIndicatorPosition ? <DropIndicator position={dropIndicatorPosition} /> : null}
      {children}
    </div>
  )
}

function DroppableGroupHeaderRow<TGroup, TItem>({
  activeDragState,
  children,
  data,
  disabled,
  dropIndicatorPosition,
  overDropState,
  sourcePlaceholder = false
}: Omit<GroupHeaderRowProps<TGroup, TItem>, 'draggable'>) {
  const dropTargetRowState = getDropTargetRowState({
    activeDragState,
    groupId: data.groupId,
    overDropState,
    rowId: data.groupId,
    rowType: 'group'
  })
  const { isOver, setNodeRef } = useDroppable({
    id: toGroupSortableId(data.groupId),
    data,
    disabled: disabled || dropTargetRowState.isBlocked
  })

  return (
    <div
      ref={setNodeRef}
      data-over={isOver || undefined}
      {...dropTargetRowState.props}
      className={joinClassNames(dropTargetRowState.props.className, dropIndicatorPosition ? 'relative' : undefined)}
      style={{ opacity: sourcePlaceholder ? 0.5 : undefined }}>
      {dropIndicatorPosition ? <DropIndicator position={dropIndicatorPosition} /> : null}
      {children}
    </div>
  )
}

type GroupFooterRowProps<TGroup, TItem> = {
  activeDragState: ActiveDragState<TGroup, TItem> | null
  children: React.ReactNode
  data: GroupDragData<TGroup>
  disabled: boolean
  dropIndicatorPosition?: DropIndicatorPosition | null
  sourcePlaceholder?: boolean
}

function GroupFooterRow<TGroup, TItem>({
  activeDragState,
  children,
  data,
  disabled,
  dropIndicatorPosition,
  sourcePlaceholder = false
}: GroupFooterRowProps<TGroup, TItem>) {
  const dropTargetRowState = getDropTargetRowState({
    activeDragState,
    groupId: data.groupId,
    overDropState: null
  })
  const { setNodeRef } = useDroppable({
    id: toGroupFooterDroppableId(data.groupId),
    data,
    disabled: disabled || dropTargetRowState.isBlocked
  })

  return (
    <div
      ref={setNodeRef}
      {...dropTargetRowState.props}
      className={joinClassNames(dropTargetRowState.props.className, dropIndicatorPosition ? 'relative' : undefined)}
      style={{ opacity: sourcePlaceholder ? 0.5 : undefined }}>
      {dropIndicatorPosition ? <DropIndicator position={dropIndicatorPosition} /> : null}
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
  const [activeDragState, setActiveDragState] = useState<ActiveDragState<TGroup, TItem> | null>(null)
  const [overDropState, setOverDropState] = useState<OverDropState | null>(null)
  const overDropStateRef = useRef<OverDropState | null>(null)

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

  const groupAppendIndicatorTargets = useMemo(() => {
    const targets = new Map<UniqueIdentifier, GroupAppendIndicatorTarget>()

    for (const row of rows) {
      const groupId = getGroupId(row.group, row.groupIndex)

      if (row.type === 'group-header') {
        targets.set(groupId, { position: 'after', rowType: 'group-header' })
        continue
      }

      if (row.type === 'item') {
        targets.set(groupId, {
          itemId: getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup),
          position: 'after',
          rowType: 'item'
        })
        continue
      }

      targets.set(groupId, { position: 'before', rowType: 'group-footer' })
    }

    return targets
  }, [getGroupId, getItemId, rows])

  const groupAppendDropTargets = useMemo(() => {
    const targets = new Map<UniqueIdentifier, ItemDragData<TGroup, TItem>>()

    for (const row of rows) {
      if (row.type !== 'item') continue

      const groupId = getGroupId(row.group, row.groupIndex)
      const itemId = getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
      targets.set(
        groupId,
        buildItemDragData({
          group: row.group,
          groupId,
          groupIndex: row.groupIndex,
          item: row.item,
          itemId,
          itemIndex: row.itemIndex,
          itemIndexInGroup: row.itemIndexInGroup
        })
      )
    }

    return targets
  }, [getGroupId, getItemId, rows])

  const groupBoundaryIndicatorTargets = useMemo(() => {
    const targets = new Map<UniqueIdentifier, GroupBoundaryIndicatorTargets>()

    for (const row of rows) {
      const groupId = getGroupId(row.group, row.groupIndex)

      if (row.type === 'group-header') {
        targets.set(groupId, {
          before: { position: 'before', rowType: 'group-header' },
          after: { position: 'after', rowType: 'group-header' }
        })
        continue
      }

      const groupTargets = targets.get(groupId)
      if (!groupTargets) continue

      if (row.type === 'item') {
        groupTargets.after = {
          itemId: getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup),
          position: 'after',
          rowType: 'item'
        }
        continue
      }

      groupTargets.after = { position: 'after', rowType: 'group-footer' }
    }

    return targets
  }, [getGroupId, getItemId, rows])

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

  const buildRowDragData = useCallback(
    (row: GroupedSortableVirtualListRow<TGroup, TItem, THeader, TFooter>): RowDragData<TGroup, TItem> | null => {
      const groupId = getGroupId(row.group, row.groupIndex)
      if (row.type === 'group-header') {
        return buildGroupDragData(row.group, groupId, row.groupIndex)
      }

      if (row.type === 'group-footer') {
        return buildGroupDragData(row.group, groupId, row.groupIndex)
      }

      if (row.type === 'item') {
        return buildItemDragData({
          group: row.group,
          groupId,
          groupIndex: row.groupIndex,
          item: row.item,
          itemId: getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup),
          itemIndex: row.itemIndex,
          itemIndexInGroup: row.itemIndexInGroup
        })
      }

      return null
    },
    [getGroupId, getItemId]
  )

  const canDragActive = useCallback(
    (active: RowDragData<TGroup, TItem>) => {
      if (isItemDragData(active)) {
        return (
          canDragItem?.(active.item, active.itemIndex, active.group, active.groupIndex, active.itemIndexInGroup) ?? true
        )
      }

      return canDragGroup?.(active.group, active.groupIndex) ?? true
    },
    [canDragGroup, canDragItem]
  )

  const buildBlockedGroupIds = useCallback(
    (active: RowDragData<TGroup, TItem>) => {
      const groupIds: UniqueIdentifier[] = []
      const candidateDataByGroupId = new Map<UniqueIdentifier, RowDragData<TGroup, TItem>[]>()

      for (const row of rows) {
        const groupId = getGroupId(row.group, row.groupIndex)
        if (!candidateDataByGroupId.has(groupId)) {
          candidateDataByGroupId.set(groupId, [])
          groupIds.push(groupId)
        }

        const rowDragData = buildRowDragData(row)
        if (rowDragData) {
          candidateDataByGroupId.get(groupId)?.push(rowDragData)
        }
      }

      const blockedGroupIds = new Set<UniqueIdentifier>()
      for (const groupId of groupIds) {
        if (!isItemDragData(active) && groupId === active.groupId) continue

        const isAllowed = (candidateDataByGroupId.get(groupId) ?? []).some((over) => {
          const payload = buildDragEndPayload(active, over, 'before')
          if (!payload) return false
          if (payload.type === 'item' && payload.overType === 'item' && payload.activeId === payload.overId)
            return false
          return shouldDropPayload(payload, effectiveDragCapabilities, canDropGroup, canDropItem)
        })

        if (!isAllowed) {
          blockedGroupIds.add(groupId)
        }
      }

      return blockedGroupIds
    },
    [buildRowDragData, canDropGroup, canDropItem, effectiveDragCapabilities, getGroupId, rows]
  )

  const clearOverDropState = useCallback(() => {
    overDropStateRef.current = null
    setOverDropState((current) => (current === null ? current : null))
  }, [])

  const clearDragState = useCallback(() => {
    setActiveDragState((current) => (current === null ? current : null))
    overDropStateRef.current = null
    setOverDropState((current) => (current === null ? current : null))
  }, [])

  const updateOverDropState = useCallback((nextOverDropState: OverDropState) => {
    overDropStateRef.current = nextOverDropState
    setOverDropState((current) => (isSameOverDropState(current, nextOverDropState) ? current : nextOverDropState))
  }, [])

  const sortingStrategy = useCallback<SortingStrategy>(
    (args) => {
      if (activeDragState?.active) {
        return null
      }

      return verticalListSortingStrategy(args)
    },
    [activeDragState]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      clearDragState()
      const active = getEventData<TGroup, TItem>(event.active.data.current)
      if (active && canDragActive(active)) {
        const initialRect = event.active.rect.current.initial
        setActiveDragState({
          active,
          blockedGroupIds: buildBlockedGroupIds(active),
          overlaySize: initialRect ? { height: initialRect.height, width: initialRect.width } : undefined
        })
      }
      if (active) onDragStart?.(buildDragStartPayload(active))
    },
    [buildBlockedGroupIds, canDragActive, clearDragState, onDragStart]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const result = buildDropPayloadFromEvent<TGroup, TItem>(event)
      if (!result || !canDragActive(result.active)) {
        clearOverDropState()
        return
      }

      if (
        result.payload.type === 'item' &&
        result.payload.overType === 'item' &&
        result.payload.activeId === result.payload.overId
      ) {
        clearOverDropState()
        return
      }

      if (!shouldDropPayload(result.payload, effectiveDragCapabilities, canDropGroup, canDropItem)) {
        clearOverDropState()
        return
      }

      updateOverDropState(getOverDropState(result.over, result.position))
    },
    [canDragActive, canDropGroup, canDropItem, clearOverDropState, effectiveDragCapabilities, updateOverDropState]
  )

  const isDragProjectionFrozen = activeDragState?.active !== undefined
  const activeGroupPlaceholderId =
    activeDragState?.active !== undefined && !isItemDragData(activeDragState.active)
      ? activeDragState.active.groupId
      : null

  const getDropIndicatorPosition = useCallback(
    (row: GroupedSortableVirtualListRow<TGroup, TItem, THeader, TFooter>): DropIndicatorPosition | null => {
      if (!overDropState) return null

      const groupId = getGroupId(row.group, row.groupIndex)
      const isGroupDrag = activeDragState?.active !== undefined && !isItemDragData(activeDragState.active)

      if (isGroupDrag) {
        if (overDropState.targetGroupId !== groupId) return null

        const target = groupBoundaryIndicatorTargets.get(groupId)?.[overDropState.position]
        if (!target || target.rowType !== row.type) return null

        if (row.type === 'item') {
          const itemId = getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
          if (target.itemId !== itemId) return null
        }

        return target.position
      }

      if (overDropState.rowType === 'item') {
        if (row.type !== 'item') return null

        const itemId = getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
        return itemId === overDropState.targetId ? overDropState.position : null
      }

      if (overDropState.targetGroupId !== groupId) return null

      const target = groupAppendIndicatorTargets.get(groupId)
      if (!target || target.rowType !== row.type) return null

      if (row.type === 'item') {
        const itemId = getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
        if (target.itemId !== itemId) return null
      }

      return target.position
    },
    [activeDragState, getGroupId, getItemId, groupAppendIndicatorTargets, groupBoundaryIndicatorTargets, overDropState]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const result = buildDropPayloadFromStateOrEvent<TGroup, TItem>(
        event,
        overDropStateRef.current,
        groupAppendDropTargets
      )
      clearDragState()
      if (!result || !canDragActive(result.active)) return

      const { payload } = result
      if (payload.type === 'item' && payload.overType === 'item' && payload.activeId === payload.overId) return
      if (!shouldDropPayload(payload, effectiveDragCapabilities, canDropGroup, canDropItem)) return

      onDragEnd?.(payload)
    },
    [
      canDragActive,
      canDropGroup,
      canDropItem,
      clearDragState,
      effectiveDragCapabilities,
      groupAppendDropTargets,
      onDragEnd
    ]
  )

  const renderRow = useCallback(
    (row: GroupedSortableVirtualListRow<TGroup, TItem, THeader, TFooter>) => {
      const groupId = getGroupId(row.group, row.groupIndex)
      const sourcePlaceholder = activeGroupPlaceholderId === groupId

      if (row.type === 'group-header') {
        const data = buildGroupDragData(row.group, groupId, row.groupIndex)

        return (
          <GroupHeaderRow
            activeDragState={activeDragState}
            data={data}
            disabled={disabled}
            dropIndicatorPosition={getDropIndicatorPosition(row)}
            freezeTransform={isDragProjectionFrozen}
            overDropState={overDropState}
            sourcePlaceholder={sourcePlaceholder}
            draggable={
              !disabled && effectiveDragCapabilities.groups && (canDragGroup?.(row.group, row.groupIndex) ?? true)
            }>
            {renderGroupHeader?.(row.header, row.group, row.groupIndex) ?? null}
          </GroupHeaderRow>
        )
      }

      if (row.type === 'group-footer') {
        const data = buildGroupDragData(row.group, groupId, row.groupIndex)

        return (
          <GroupFooterRow
            activeDragState={activeDragState}
            data={data}
            disabled={disabled}
            dropIndicatorPosition={getDropIndicatorPosition(row)}
            sourcePlaceholder={sourcePlaceholder}>
            {renderGroupFooter?.(row.footer, row.group, row.groupIndex) ?? null}
          </GroupFooterRow>
        )
      }

      const itemId = getItemId(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
      const itemDisabled =
        disabled ||
        !effectiveDragCapabilities.items ||
        !(canDragItem?.(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup) ?? true)
      const data = buildItemDragData({
        group: row.group,
        groupId,
        groupIndex: row.groupIndex,
        item: row.item,
        itemId,
        itemIndex: row.itemIndex,
        itemIndexInGroup: row.itemIndexInGroup
      })

      return (
        <SortableItemRow
          activeDragState={activeDragState}
          data={data}
          disabled={itemDisabled}
          dropIndicatorPosition={getDropIndicatorPosition(row)}
          freezeTransform={isDragProjectionFrozen}
          overDropState={overDropState}
          sourcePlaceholder={sourcePlaceholder}>
          {renderItem(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)}
        </SortableItemRow>
      )
    },
    [
      activeDragState,
      activeGroupPlaceholderId,
      canDragGroup,
      canDragItem,
      disabled,
      effectiveDragCapabilities.groups,
      effectiveDragCapabilities.items,
      getDropIndicatorPosition,
      getGroupId,
      getItemId,
      isDragProjectionFrozen,
      overDropState,
      renderGroupFooter,
      renderGroupHeader,
      renderItem
    ]
  )

  const dragOverlayContent = useMemo(() => {
    const active = activeDragState?.active
    if (!active) return null

    if (isItemDragData(active)) {
      return renderItem(active.item, active.itemIndex, active.group, active.groupIndex, active.itemIndexInGroup)
    }

    const headerRow = rows.find(
      (row) => row.type === 'group-header' && getGroupId(row.group, row.groupIndex) === active.groupId
    )
    if (!headerRow || headerRow.type !== 'group-header') return null

    return renderGroupHeader?.(headerRow.header, headerRow.group, headerRow.groupIndex) ?? null
  }, [activeDragState, getGroupId, renderGroupHeader, renderItem, rows])

  const dragOverlay = (
    <DragOverlay dropAnimation={null}>
      {dragOverlayContent ? (
        <div
          className="pointer-events-none"
          style={{
            height: activeDragState?.overlaySize?.height,
            width: activeDragState?.overlaySize?.width
          }}>
          {dragOverlayContent}
        </div>
      ) : null}
    </DragOverlay>
  )

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={clearDragState}
      onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={sortingStrategy}>
        <DynamicVirtualList {...virtualListProps} list={rows} estimateSize={estimateRowSize} children={renderRow} />
      </SortableContext>
      {createPortal(dragOverlay, document.body)}
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

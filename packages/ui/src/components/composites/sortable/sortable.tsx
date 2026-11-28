import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers'
import { closestCenter } from '@dnd-kit/collision'
import { Accessibility } from '@dnd-kit/dom'
import { RestrictToElement, RestrictToWindow } from '@dnd-kit/dom/modifiers'
import { getFirstScrollableAncestor } from '@dnd-kit/dom/utilities'
import { arrayMove } from '@dnd-kit/helpers'
import type { DragDropManager, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/react'
import { DragOverlay } from '@dnd-kit/react'
import React, { type ComponentProps, useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@cherrystudio/ui/lib/utils'

import { DragDropRoot } from './drag-drop-root'
import { ItemRenderer } from './item-renderer'
import { SortableItem } from './sortable-item'
import type { RenderItemType, SortableAccessibility, SortableItemId } from './types'

const RESTRICT_TO_SCROLLABLE_ANCESTOR = RestrictToElement.configure({
  element: ({ source }) => (source?.element ? getFirstScrollableAncestor(source.element) : null)
})

type Plugins = ComponentProps<typeof DragDropRoot>['plugins']

function createPlugins({ screenReaderInstructions, announcements }: SortableAccessibility): Plugins {
  const options: NonNullable<ConstructorParameters<typeof Accessibility>[1]> = {
    screenReaderInstructions,
    announcements: announcements && {
      dragstart: ({ operation: { source } }) =>
        source ? announcements.onDragStart({ activeId: source.id }) : undefined,
      dragover: ({ operation: { source, target } }) =>
        source && source.id !== target?.id
          ? announcements.onDragOver({ activeId: source.id, overId: target?.id ?? null })
          : undefined,
      dragend: ({ operation: { source }, canceled }) => {
        if (!source) return undefined
        return (canceled ? announcements.onDragCancel : announcements.onDragEnd)({ activeId: source.id })
      }
    }
  }
  const configured = Accessibility.configure(options)

  return (defaults) => defaults.map((plugin) => (plugin === Accessibility ? configured : plugin))
}

interface SortableProps<T> {
  /** Array of sortable items */
  items: T[]
  /** Function or key to get unique identifier for each item */
  itemKey: keyof T | ((item: T) => SortableItemId)
  /** Callback when sorting is complete, receives old and new indices */
  onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
  /** Callback when drag starts */
  onDragStart?: (event: { activeId: SortableItemId }) => void
  /** Callback when drag ends */
  onDragEnd?: () => void
  /** Callback when drag is cancelled */
  onDragCancel?: () => void
  /** Function to render individual item, receives item data and drag state */
  renderItem: RenderItemType<T>
  /** Layout type - 'list' for vertical/horizontal list, 'grid' for grid layout */
  layout?: 'list' | 'grid'
  /** Whether sorting is horizontal */
  horizontal?: boolean
  /** Whether to use drag overlay
   * If you want to hide ghost item, set showGhost to false rather than useDragOverlay.
   */
  useDragOverlay?: boolean
  /** Collision detection algorithm for rows of very different sizes; defaults to pointer + shape intersection */
  collisionDetection?: 'closest-center'
  /** Whether to show ghost item, only works when useDragOverlay is true */
  showGhost?: boolean
  /** Item list class name */
  className?: string
  /** Disable dragging for the whole collection */
  disabled?: boolean
  /** Refuse to drag individual rows; they still accept drops */
  isItemDragDisabled?: (item: T) => boolean
  /** Item list style */
  listStyle?: React.CSSProperties
  /** Item style */
  itemStyle?: React.CSSProperties
  /** Item gap */
  gap?: number | string
  /** Restrictions, shortcuts for some modifiers */
  restrictions?: {
    /** Keep the dragged item inside the window */
    windowEdges?: boolean
    /** Keep the dragged item inside its nearest scrollable ancestor */
    scrollableAncestor?: boolean
  }
  /**
   * Route the drag activator to a dedicated handle instead of the whole row.
   * `renderItem` then receives `dragHandleProps`; attach its `ref` to the handle element,
   * keeping the row itself non-interactive (better for nested controls / a11y).
   */
  dragHandle?: boolean
  /** Localized `announcements` and `screenReaderInstructions`, so drag feedback isn't the default English + item id. */
  accessibility?: SortableAccessibility
}

function Sortable<T>({
  items,
  itemKey,
  onSortEnd,
  onDragStart: customOnDragStart,
  onDragEnd: customOnDragEnd,
  onDragCancel: customOnDragCancel,
  renderItem,
  layout = 'list',
  horizontal = false,
  useDragOverlay = true,
  collisionDetection,
  showGhost = false,
  className,
  disabled = false,
  isItemDragDisabled,
  listStyle,
  itemStyle,
  gap,
  restrictions,
  dragHandle = false,
  accessibility
}: SortableProps<T>) {
  const getId = useCallback(
    (item: T) => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as SortableItemId)),
    [itemKey]
  )

  const itemIds = useMemo(() => items.map(getId), [items, getId])
  const itemById = useMemo(() => new Map(items.map((item, index) => [itemIds[index], item])), [items, itemIds])

  // React owns the order during a drag. The library's optimistic plugin moves DOM nodes instead and
  // has no way back when a consumer rejects the drop, leaving the rows out of step with `items`.
  const [previewIds, setPreviewIds] = useState<SortableItemId[] | null>(null)
  // The library wraps these handlers in transitions, so a drop can land before the last preview commits.
  const latestPreviewIds = useRef<SortableItemId[] | null>(null)

  const orderedItems = useMemo(
    () =>
      previewIds?.flatMap((id) => {
        const item = itemById.get(id)
        return item === undefined ? [] : [item]
      }) ?? items,
    [itemById, items, previewIds]
  )

  const updatePreview = (ids: SortableItemId[] | null) => {
    latestPreviewIds.current = ids
    setPreviewIds(ids)
  }

  const handleDragStart = ({ operation: { source } }: DragStartEvent) => {
    if (source) {
      customOnDragStart?.({ activeId: source.id })
    }
  }

  const handleDragOver = (event: DragOverEvent, manager: DragDropManager) => {
    event.preventDefault()

    // Status stays `dragging` until the drop renders, and auto-scroll can still report a target until then.
    if (manager.dragOperation.controller?.signal.aborted) return

    const { source, target } = event.operation
    if (!source || !target || source.id === target.id) return

    const order = latestPreviewIds.current ?? itemIds
    const fromIndex = order.indexOf(source.id)
    const toIndex = order.indexOf(target.id)
    // The dragged row left `items` before the first dragover, e.g. the queue drained it.
    if (fromIndex === -1 || toIndex === -1) return

    manager.collisionObserver.disable()
    updatePreview(arrayMove(order, fromIndex, toIndex))
    // The row that just shifted is still the target, so re-entering its new slot would fire no dragover.
    void manager.renderer.rendering
      .then(() => manager.actions.setDropTarget(source.id))
      .then(() => manager.collisionObserver.enable())
  }

  const handleDragEnd = ({ canceled, operation: { source } }: DragEndEvent) => {
    const order = latestPreviewIds.current
    updatePreview(null)

    if (canceled) {
      customOnDragCancel?.()
      return
    }

    customOnDragEnd?.()
    // Commit what the list shows: auto-scroll can carry the rows out from under the pointer before the drop.
    if (source && order) {
      const oldIndex = itemIds.indexOf(source.id)
      const newIndex = order.filter((id) => itemById.has(id)).indexOf(source.id)
      if (oldIndex !== newIndex) {
        onSortEnd({ oldIndex, newIndex })
      }
    }
  }

  const { windowEdges = false, scrollableAncestor = false } = restrictions ?? {}

  const modifiers = useMemo(
    () => [
      ...(layout === 'list' ? [horizontal ? RestrictToHorizontalAxis : RestrictToVerticalAxis] : []),
      ...(windowEdges ? [RestrictToWindow] : []),
      ...(scrollableAncestor ? [RESTRICT_TO_SCROLLABLE_ANCESTOR] : [])
    ],
    [layout, horizontal, windowEdges, scrollableAncestor]
  )

  const plugins = useMemo(() => (accessibility ? createPlugins(accessibility) : undefined), [accessibility])

  return (
    <DragDropRoot
      modifiers={modifiers}
      plugins={plugins}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}>
      <div
        className={cn(
          layout === 'grid'
            ? 'grid w-full grid-cols-[repeat(auto-fill,minmax(280px,1fr))] max-md:grid-cols-1'
            : cn('flex', horizontal ? 'flex-row items-center' : 'w-full flex-col items-stretch'),
          className
        )}
        data-layout={layout}
        data-direction={horizontal ? 'horizontal' : 'vertical'}
        style={{ ...listStyle, gap }}>
        {orderedItems.map((item, index) => {
          const id = getId(item)
          return (
            <SortableItem
              key={id}
              id={id}
              index={index}
              item={item}
              renderItem={renderItem}
              disabled={disabled}
              dragDisabled={isItemDragDisabled?.(item)}
              useDragOverlay={useDragOverlay}
              showGhost={showGhost}
              itemStyle={itemStyle}
              collisionDetector={collisionDetection === 'closest-center' ? closestCenter : undefined}
              dragHandle={dragHandle}
            />
          )
        })}
      </div>

      {useDragOverlay &&
        createPortal(
          <DragOverlay>
            {(source) => {
              const item = itemById.get(source.id)
              return item === undefined ? null : (
                <ItemRenderer item={item} renderItem={renderItem} itemStyle={itemStyle} dragOverlay />
              )
            }}
          </DragOverlay>,
          document.body
        )}
    </DragDropRoot>
  )
}

export default Sortable

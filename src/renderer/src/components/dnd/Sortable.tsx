import {
  Active,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  DropAnimation,
  KeyboardSensor,
  Over,
  TouchSensor,
  UniqueIdentifier,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { restrictToHorizontalAxis, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import React, { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

import { ItemRenderer } from './ItemRenderer'
import { SortableItem } from './SortableItem'
import { PortalSafePointerSensor } from './utils'

interface SortableProps<T> {
  /** Array of sortable items */
  items: T[]
  /** Function or key to get unique identifier for each item */
  itemKey: keyof T | ((item: T) => string | number)
  /** Callback when sorting is complete, receives old and new indices */
  onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
  /** Callback when drag starts, will be passed to dnd-kit's onDragStart */
  onDragStart?: (event: { active: Active }) => void
  /** Callback when drag ends, will be passed to dnd-kit's onDragEnd */
  onDragEnd?: (event: { over: Over }) => void
  /** Function to render individual item, receives item data and drag state */
  renderItem: (item: T, props: { dragging: boolean }) => React.ReactNode
  /** Layout type - 'list' for vertical/horizontal list, 'grid' for grid layout */
  layout?: 'list' | 'grid'
  /** Whether sorting is horizontal */
  horizontal?: boolean
  /** Whether to use drag overlay
   * If you want to hide ghost item, set showGhost to false rather than useDragOverlay.
   */
  useDragOverlay?: boolean
  /** Whether to show ghost item, only works when useDragOverlay is true */
  showGhost?: boolean
  /** Item list class name */
  className?: string
  /** Item list style */
  listStyle?: React.CSSProperties
  /** Ghost item style */
  ghostItemStyle?: React.CSSProperties
}

function Sortable<T>({
  items,
  itemKey,
  onSortEnd,
  onDragStart: customOnDragStart,
  onDragEnd: customOnDragEnd,
  renderItem,
  layout = 'list',
  horizontal = false,
  useDragOverlay = true,
  showGhost = false,
  className,
  listStyle
}: SortableProps<T>) {
  const sensors = useSensors(
    useSensor(PortalSafePointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const getId = useCallback(
    (item: T) => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as string | number)),
    [itemKey]
  )

  const itemIds = useMemo(() => items.map(getId), [items, getId])

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)

  const activeItem = activeId ? items.find((item) => getId(item) === activeId) : null

  const getIndex = (id: UniqueIdentifier) => itemIds.indexOf(id)

  const activeIndex = activeId ? getIndex(activeId) : -1

  const handleDragStart = ({ active }) => {
    customOnDragStart?.({ active })
    if (active) {
      setActiveId(active.id)
    }
  }

  const handleDragEnd = ({ over }) => {
    setActiveId(null)

    customOnDragEnd?.({ over })
    if (over) {
      const overIndex = getIndex(over.id)
      if (activeIndex !== overIndex) {
        onSortEnd({ oldIndex: activeIndex, newIndex: overIndex })
      }
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const strategy =
    layout === 'list' ? (horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy) : rectSortingStrategy
  const modifiers = layout === 'list' ? (horizontal ? [restrictToHorizontalAxis] : [restrictToVerticalAxis]) : []

  const dropAnimation: DropAnimation = useMemo(
    () => ({
      sideEffects: defaultDropAnimationSideEffects({
        styles: {
          active: { opacity: showGhost ? '0.25' : '0' }
        }
      })
    }),
    [showGhost]
  )

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={modifiers}>
      <SortableContext items={itemIds} strategy={strategy}>
        <ListWrapper className={className} data-layout={layout} style={listStyle}>
          {items.map((item, index) => (
            <SortableItem
              key={itemIds[index]}
              item={item}
              getId={getId}
              renderItem={renderItem}
              useDragOverlay={useDragOverlay}
              showGhost={showGhost}
            />
          ))}
        </ListWrapper>
      </SortableContext>

      {useDragOverlay
        ? createPortal(
            <DragOverlay adjustScale dropAnimation={dropAnimation}>
              {activeItem ? <ItemRenderer item={activeItem} renderItem={renderItem} dragOverlay /> : null}
            </DragOverlay>,
            document.body
          )
        : null}
    </DndContext>
  )
}

const ListWrapper = styled.div`
  &[data-layout='grid'] {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    width: 100%;
    gap: 12px;

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  }
`

export default Sortable

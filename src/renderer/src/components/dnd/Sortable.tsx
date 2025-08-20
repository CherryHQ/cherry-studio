import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
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

import { ItemRenderer } from './ItemRenderer'
import { SortableItem } from './SortableItem'

interface SortableProps<T> {
  items: T[]
  itemKey: keyof T | ((item: T) => string | number)
  onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
  renderItem: (item: T, props: { dragging: boolean }) => React.ReactNode
  layout?: 'list' | 'grid'
  horizontal?: boolean
  className?: string
  useDragOverlay?: boolean
}

function Sortable<T>({
  items,
  itemKey,
  onSortEnd,
  renderItem,
  layout = 'list',
  horizontal = false,
  className,
  useDragOverlay = true
}: SortableProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
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

  const itemIds = useMemo(() => {
    return items.map(getId)
  }, [items, getId])

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)

  const activeItem = activeId
    ? items.find((item) => {
        const id = typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as string | number)
        return id === activeId
      })
    : null

  const getIndex = (id: UniqueIdentifier) => itemIds.indexOf(id)

  const activeIndex = activeId ? getIndex(activeId) : -1

  const handleDragStart = ({ active }) => {
    if (active) {
      setActiveId(active.id)
    }
  }

  const handleDragEnd = ({ over }) => {
    setActiveId(null)

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

  const dropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5'
        }
      }
    })
  }

  const strategy =
    layout === 'list' ? (horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy) : rectSortingStrategy
  const modifiers = layout === 'list' ? (horizontal ? [restrictToHorizontalAxis] : [restrictToVerticalAxis]) : []

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={modifiers}>
      <SortableContext items={itemIds} strategy={strategy}>
        <div className={className} data-layout={layout}>
          {items.map((item, index) => (
            <SortableItem
              key={itemIds[index]}
              item={item}
              getId={getId}
              renderItem={renderItem}
              useDragOverlay={useDragOverlay}
            />
          ))}
        </div>
      </SortableContext>

      {useDragOverlay &&
        activeItem &&
        createPortal(
          <DragOverlay adjustScale dropAnimation={dropAnimation}>
            <ItemRenderer item={activeItem} renderItem={renderItem} dragOverlay />
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  )
}

export default Sortable

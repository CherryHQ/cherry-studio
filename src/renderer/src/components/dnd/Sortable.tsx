import { DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { restrictToHorizontalAxis, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import React, { useMemo } from 'react'

import { SortableItem } from './SortableItem'

interface SortableProps<T> {
  items: T[]
  itemKey: keyof T | ((item: T) => string | number)
  onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
  renderItem: (item: T, props: { isDragging: boolean }) => React.ReactNode
  layout?: 'list' | 'grid'
  horizontal?: boolean
  className?: string
}

function Sortable<T>({
  items,
  itemKey,
  onSortEnd,
  renderItem,
  layout = 'list',
  horizontal = false,
  className
}: SortableProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const itemIds = useMemo(() => {
    const getId = (item: T) => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as string | number))
    return items.map(getId)
  }, [items, itemKey])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = itemIds.indexOf(active.id)
      const newIndex = itemIds.indexOf(over.id)
      onSortEnd({ oldIndex, newIndex })
    }
  }

  const strategy =
    layout === 'list' ? (horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy) : rectSortingStrategy
  const modifiers = layout === 'list' ? (horizontal ? [restrictToHorizontalAxis] : [restrictToVerticalAxis]) : []

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd} modifiers={modifiers}>
      <SortableContext items={itemIds} strategy={strategy}>
        <div className={className} data-layout={layout}>
          {items.map((item) => (
            <SortableItem key={itemIds[items.indexOf(item)]} item={item} itemKey={itemKey} renderItem={renderItem} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

export default Sortable

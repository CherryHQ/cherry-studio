import { useSortable } from '@dnd-kit/sortable'
import React from 'react'

import { ItemRenderer } from './ItemRenderer'

interface SortableItemProps<T> {
  item: T
  itemKey: keyof T | ((item: T) => string | number)
  renderItem: (item: T, props: { dragging: boolean }) => React.ReactNode
  useDragOverlay?: boolean
}

export function SortableItem<T>({ item, itemKey, renderItem, useDragOverlay = true }: SortableItemProps<T>) {
  const getId = () => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as string | number))
  const id = getId()

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  })

  return (
    <ItemRenderer
      ref={setNodeRef}
      item={item}
      renderItem={renderItem}
      dragging={isDragging}
      dragOverlay={!useDragOverlay && isDragging}
      transform={transform}
      transition={transition}
      listeners={listeners}
      {...attributes}
    />
  )
}

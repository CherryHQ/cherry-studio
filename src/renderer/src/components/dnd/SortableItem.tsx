import { useSortable } from '@dnd-kit/sortable'
import React from 'react'

import { ItemRenderer } from './ItemRenderer'

interface SortableItemProps<T> {
  item: T
  getId: (item: T) => string | number
  renderItem: (item: T, props: { dragging: boolean }) => React.ReactNode
  useDragOverlay?: boolean
  showGhost?: boolean
}

export function SortableItem<T>({
  item,
  getId,
  renderItem,
  useDragOverlay = true,
  showGhost = true
}: SortableItemProps<T>) {
  const id = getId(item)

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
      ghost={showGhost && useDragOverlay && isDragging}
      transform={transform}
      transition={transition}
      listeners={listeners}
      {...attributes}
    />
  )
}

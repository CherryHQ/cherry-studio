import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import React, { CSSProperties } from 'react'
import styled from 'styled-components'

interface SortableItemProps<T> {
  item: T
  itemKey: keyof T | ((item: T) => string | number)
  renderItem: (item: T, props: { isDragging: boolean }) => React.ReactNode
}

export function SortableItem<T>({ item, itemKey, renderItem }: SortableItemProps<T>) {
  const getId = () => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as string | number))
  const id = getId()

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const wrapperStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    ...(isDragging && {
      cursor: 'grabbing',
      zIndex: 9999
    })
  }

  return (
    <div ref={setNodeRef} style={wrapperStyle} {...attributes} {...listeners} className="sortable-item">
      <ItemContent className={isDragging ? 'dragging' : ''}>{renderItem(item, { isDragging })}</ItemContent>
    </div>
  )
}

const ItemContent = styled.div`
  --scale: 1.02;

  &.dragging {
    animation: pop 200ms cubic-bezier(0.18, 0.67, 0.6, 1.22);
    transform: scale(var(--scale));
    opacity: 1;
  }

  @keyframes pop {
    0% {
      transform: scale(1);
    }
    100% {
      transform: scale(var(--scale));
    }
  }
`

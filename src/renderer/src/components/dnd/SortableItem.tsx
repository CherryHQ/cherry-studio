import { useSortable } from '@dnd-kit/sortable'
import { motion } from 'motion/react'
import React from 'react'
import styled from 'styled-components'

interface SortableItemProps<T> {
  item: T
  itemKey: keyof T | ((item: T) => string | number)
  renderItem: (item: T, props: { isDragging: boolean }) => React.ReactNode
}

export function SortableItem<T>({ item, itemKey, renderItem }: SortableItemProps<T>) {
  const getId = () => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as string | number))
  const id = getId()

  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id,
    transition: null
  })

  return (
    <ItemContent
      ref={setNodeRef}
      layoutId={String(id)}
      animate={
        transform
          ? {
              x: transform.x,
              y: transform.y,
              scale: isDragging ? 1.02 : 1,
              zIndex: isDragging ? 1 : 0
            }
          : {
              x: 0,
              y: 0,
              scale: 1
            }
      }
      transition={{
        duration: !isDragging ? 0.2 : 0,
        easings: {
          type: 'spring'
        },
        scale: {
          duration: 0.2
        },
        zIndex: {
          delay: isDragging ? 0 : 0.2
        }
      }}
      className="sortable-item"
      {...attributes}
      {...listeners}>
      {renderItem(item, { isDragging })}
    </ItemContent>
  )
}

const ItemContent = styled(motion.div)`
  position: relative;
`

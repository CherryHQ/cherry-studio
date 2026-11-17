import type { CollisionDetector } from '@dnd-kit/collision'
import { useSortable } from '@dnd-kit/react/sortable'

import { ItemRenderer } from './item-renderer'
import type { RenderItemType, SortableItemId } from './types'

interface SortableItemProps<T> {
  item: T
  id: SortableItemId
  index: number
  renderItem: RenderItemType<T>
  disabled?: boolean
  /** Refuse to drag this row while it keeps accepting drops. */
  dragDisabled?: boolean
  useDragOverlay?: boolean
  showGhost?: boolean
  itemStyle?: React.CSSProperties
  collisionDetector?: CollisionDetector
  /** Route the drag activator to a handle (via renderItem's dragHandleProps) instead of the whole row. */
  dragHandle?: boolean
}

export function SortableItem<T>({
  item,
  id,
  index,
  renderItem,
  disabled = false,
  dragDisabled = false,
  useDragOverlay = true,
  showGhost = true,
  itemStyle,
  collisionDetector,
  dragHandle = false
}: SortableItemProps<T>) {
  const { ref, handleRef, isDragSource } = useSortable({
    id,
    index,
    disabled: !disabled && dragDisabled ? { draggable: true, droppable: false } : disabled,
    collisionDetector,
    // Rows now shift by a Web Animation, which a CSS `transition: none` cannot turn off.
    transition: itemStyle?.transition === 'none' ? null : undefined
  })

  return (
    <ItemRenderer
      ref={ref}
      item={item}
      index={index}
      renderItem={renderItem}
      dragging={isDragSource}
      dragDisabled={dragDisabled}
      dragOverlay={!useDragOverlay && isDragSource}
      ghost={showGhost && useDragOverlay && isDragSource}
      dragHandleProps={dragHandle ? { ref: handleRef } : undefined}
      itemStyle={itemStyle}
    />
  )
}

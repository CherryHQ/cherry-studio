import { type CSSProperties, type ReactNode, useCallback, useMemo } from 'react'

import { Sortable } from '../Sortable'
import { reorderVisibleSubset } from './reorderVisibleSubset'

type ReorderableItemId = string | number

export interface ReorderableListProps<T> {
  items: T[]
  visibleItems?: T[]
  getId: (item: T) => ReorderableItemId
  renderItem: (item: T, index: number, state: { dragging: boolean }) => ReactNode
  onReorder: (nextItems: T[]) => void | Promise<void>
  layout?: 'list' | 'grid'
  direction?: 'vertical' | 'horizontal'
  disabled?: boolean
  className?: string
  listStyle?: CSSProperties
  itemStyle?: CSSProperties
  gap?: number | string
  useDragOverlay?: boolean
  showGhost?: boolean
  restrictions?: {
    windowEdges?: boolean
    scrollableAncestor?: boolean
  }
  onDragStateChange?: (dragging: boolean) => void
  onReorderError?: (error: unknown) => void
}

export function ReorderableList<T>({
  items,
  visibleItems = items,
  getId,
  renderItem,
  onReorder,
  layout = 'list',
  direction = 'vertical',
  disabled = false,
  className,
  listStyle,
  itemStyle,
  gap,
  useDragOverlay = true,
  showGhost = true,
  restrictions,
  onDragStateChange,
  onReorderError
}: ReorderableListProps<T>) {
  const visibleIndexById = useMemo(() => {
    return new Map(visibleItems.map((item, index) => [getId(item), index]))
  }, [getId, visibleItems])

  const handleSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      if (disabled) {
        return
      }

      const nextItems = reorderVisibleSubset({
        items,
        visibleItems,
        fromIndex: oldIndex,
        toIndex: newIndex,
        getId
      })

      if (nextItems !== items) {
        void Promise.resolve(onReorder(nextItems)).catch((error: unknown) => {
          onReorderError?.(error)
        })
      }
    },
    [disabled, getId, items, onReorder, onReorderError, visibleItems]
  )

  const handleDragStart = useCallback(() => {
    if (!disabled) {
      onDragStateChange?.(true)
    }
  }, [disabled, onDragStateChange])

  const handleDragEnd = useCallback(() => {
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const handleDragCancel = useCallback(() => {
    onDragStateChange?.(false)
  }, [onDragStateChange])

  return (
    <Sortable
      items={visibleItems}
      itemKey={getId}
      onSortEnd={handleSortEnd}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      renderItem={(item, state) => renderItem(item, visibleIndexById.get(getId(item)) ?? -1, state)}
      layout={layout}
      horizontal={direction === 'horizontal'}
      className={className}
      disabled={disabled}
      listStyle={listStyle}
      itemStyle={itemStyle}
      gap={gap}
      restrictions={restrictions}
      useDragOverlay={useDragOverlay}
      showGhost={showGhost}
    />
  )
}

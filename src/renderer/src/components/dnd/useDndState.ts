import { useDndContext } from '@dnd-kit/core'

interface DndState {
  /** 是否有元素正在拖拽 */
  isDragging: boolean
  /** 当前拖拽元素的ID */
  draggedId: string | number | null
  /** 当前悬停位置的ID */
  overId: string | number | null
  /** 是否正在悬停在某个可放置区域 */
  isOver: boolean
}

/**
 * 提供 dnd-kit 的拖拽状态管理，作为 DraggableList 的 onDragStart/onDragEnd 回调的替代方案。
 *
 * @returns 当前拖拽状态信息
 */
export function useDndState(): DndState {
  const { active, over } = useDndContext()

  return {
    isDragging: active !== null,
    draggedId: active?.id ?? null,
    overId: over?.id ?? null,
    isOver: over !== null
  }
}

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'

/**
 * Props to spread onto a dedicated drag handle element so dnd-kit uses it as the
 * activator instead of the whole row. Only provided when the Sortable/ReorderableList
 * runs in `dragHandle` mode; the in-list row is then left non-interactive.
 */
export interface SortableDragHandleProps {
  ref: (element: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
}

export type RenderItemType<T> = (
  item: T,
  props: { dragging: boolean; overlay: boolean; dragHandleProps?: SortableDragHandleProps }
) => React.ReactNode

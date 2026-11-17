export type SortableItemId = string | number

/**
 * Attach `ref` to a dedicated drag handle element so it becomes the activator instead
 * of the whole row. Only provided when the Sortable/ReorderableList runs in `dragHandle`
 * mode; the in-list row is then left non-interactive.
 */
export interface SortableDragHandleProps {
  ref: (element: Element | null) => void
}

export interface SortableAccessibility {
  screenReaderInstructions?: { draggable: string }
  announcements?: {
    onDragStart: (event: { activeId: SortableItemId }) => string | undefined
    onDragOver: (event: { activeId: SortableItemId; overId: SortableItemId | null }) => string | undefined
    onDragEnd: (event: { activeId: SortableItemId }) => string | undefined
    onDragCancel: (event: { activeId: SortableItemId }) => string | undefined
  }
}

export type RenderItemType<T> = (
  item: T,
  props: { dragging: boolean; overlay: boolean; dragHandleProps?: SortableDragHandleProps }
) => React.ReactNode

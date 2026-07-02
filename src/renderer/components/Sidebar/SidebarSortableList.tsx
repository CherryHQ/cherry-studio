import { Sortable } from '@cherrystudio/ui'
import type { ReactNode } from 'react'
import { useCallback, useRef } from 'react'

/**
 * After a drag-drop, dnd-kit fires a trailing synthetic click on the dragged
 * element; swallow clicks for a short window so a reorder never navigates.
 */
const DRAG_CLICK_SUPPRESS_MS = 250

/** Wrap a click handler so it is ignored right after a drag settles. */
export type SidebarClickGuard = (handler: () => void) => () => void

interface SidebarSortableListProps<T> {
  items: T[]
  itemKey: keyof T
  /** Container classes; applied to both the sortable and the plain fallback list. */
  className?: string
  /** When provided the zone is drag-sortable; otherwise it renders a static list. */
  onReorder?: (event: { oldIndex: number; newIndex: number }) => void
  children: (item: T, guardClick: SidebarClickGuard) => ReactNode
}

/**
 * Renders a single sidebar zone (built-in apps or mini apps) as an independent
 * drag-sort list. Each zone is its own Sortable, so items can only be reordered
 * within their own zone — a drag never crosses between apps and mini apps.
 */
export function SidebarSortableList<T>({
  items,
  itemKey,
  className,
  onReorder,
  children
}: SidebarSortableListProps<T>) {
  const suppressClickUntilRef = useRef(0)

  const markDragSettled = useCallback(() => {
    suppressClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS
  }, [])

  const guardClick = useCallback<SidebarClickGuard>(
    (handler) => () => {
      if (Date.now() < suppressClickUntilRef.current) return
      handler()
    },
    []
  )

  if (!onReorder) {
    return <div className={className}>{items.map((item) => children(item, guardClick))}</div>
  }

  return (
    <Sortable
      items={items}
      itemKey={itemKey}
      layout="list"
      className={className}
      onDragEnd={markDragSettled}
      onDragCancel={markDragSettled}
      onSortEnd={onReorder}
      renderItem={(item) => children(item, guardClick)}
    />
  )
}

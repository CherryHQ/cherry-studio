import type { Active } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { Sortable } from '@cherrystudio/ui'

/**
 * After a drag-drop, dnd-kit fires a trailing synthetic click on the dragged
 * element; swallow clicks for a short window so a reorder never navigates.
 */
const DRAG_CLICK_SUPPRESS_MS = 250

/** Wrap a click handler so it is ignored right after that item was dragged. */
export type SidebarClickGuard = (item: unknown, handler: () => void) => () => void

interface SidebarSortableListProps<T> {
  items: T[]
  itemKey: keyof T
  /** Container classes; applied to both the sortable and the plain fallback list. */
  className?: string
  /** When provided the list is drag-sortable; otherwise it renders a static list. */
  onReorder?: (event: { oldIndex: number; newIndex: number }) => void
  children: (item: T, guardClick: SidebarClickGuard) => ReactNode
}

/**
 * Renders resolved sidebar entries as one generic sortable list. The caller
 * decides whether the entries are built-in apps, mini apps, or future item types.
 */
export function SidebarSortableList<T>({
  items,
  itemKey,
  className,
  onReorder,
  children
}: SidebarSortableListProps<T>) {
  const suppressClickRef = useRef(false)
  const suppressClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draggedItemIdRef = useRef<string | null>(null)

  const clearClickSuppression = useCallback(() => {
    if (suppressClickTimeoutRef.current) {
      clearTimeout(suppressClickTimeoutRef.current)
      suppressClickTimeoutRef.current = null
    }
    suppressClickRef.current = false
    draggedItemIdRef.current = null
  }, [])

  const markDragStarted = useCallback((event: { active: Active }) => {
    if (suppressClickTimeoutRef.current) {
      clearTimeout(suppressClickTimeoutRef.current)
      suppressClickTimeoutRef.current = null
    }
    draggedItemIdRef.current = String(event.active.id)
    suppressClickRef.current = true
  }, [])

  const markDragSettled = useCallback(() => {
    suppressClickTimeoutRef.current = setTimeout(clearClickSuppression, DRAG_CLICK_SUPPRESS_MS)
  }, [clearClickSuppression])

  useEffect(() => clearClickSuppression, [clearClickSuppression])

  const guardClick = useCallback<SidebarClickGuard>(
    (item, handler) => () => {
      if (String(item) === draggedItemIdRef.current && suppressClickRef.current) {
        clearClickSuppression()
        return
      }
      handler()
    },
    [clearClickSuppression]
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
      onDragStart={markDragStarted}
      onDragEnd={markDragSettled}
      onDragCancel={markDragSettled}
      onSortEnd={onReorder}
      renderItem={(item) => children(item, guardClick)}
    />
  )
}

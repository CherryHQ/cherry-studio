import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { PaneDirection, PaneTab } from '@shared/data/cache/cacheValueTypes'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { usePanesActions } from '../../hooks/usePanes'
import { computeInsertIndex, detectEdgeZone, edgeToSplit, type EdgeZone } from '../../utils/paneDropDetection'
import { PortalSafePointerSensor } from '../Sortable/utils'
import { usePaneGeometry } from './PaneGeometryContext'
import { TabDragGhost } from './TabDragGhost'

/** Data carried by a draggable Tab. */
export interface TabDragData {
  paneId: string
  tabId: string
  tab: PaneTab
}

/** Per-pane drop preview — consumed by `<PaneDropIndicator>`. */
export type PaneDropPreview =
  | { kind: 'reorder'; paneId: string; insertIndex: number }
  | { kind: 'move'; paneId: string; insertIndex: number }
  | { kind: 'split'; paneId: string; direction: PaneDirection; placement: 'before' | 'after'; zone: EdgeZone }

function previewsEqual(a: PaneDropPreview | null, b: PaneDropPreview | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.kind !== b.kind || a.paneId !== b.paneId) return false
  switch (a.kind) {
    case 'reorder':
    case 'move':
      return a.insertIndex === (b as typeof a).insertIndex
    case 'split': {
      const bs = b as typeof a
      return a.direction === bs.direction && a.placement === bs.placement && a.zone === bs.zone
    }
  }
}

interface DropPreviewContextValue {
  preview: PaneDropPreview | null
}

const DropPreviewContext = createContext<DropPreviewContextValue>({ preview: null })

/** Look up the active drop preview — returns null when the target pane isn't the one being hovered. */
export function usePaneDropPreview(paneId: string): PaneDropPreview | null {
  const { preview } = use(DropPreviewContext)
  if (!preview) return null
  return preview.paneId === paneId ? preview : null
}

export function PaneDndProvider({ children }: { children: ReactNode }) {
  const { geometryRef } = usePaneGeometry()
  const { moveTabToPane, splitPaneWithTab, reorderTabsInPane, detachTab } = usePanesActions()

  const sensors = useSensors(
    useSensor(PortalSafePointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const [activeDrag, setActiveDrag] = useState<TabDragData | null>(null)
  const [preview, setPreview] = useState<PaneDropPreview | null>(null)

  // Track the pointer in viewport coordinates so drag handlers can classify zones.
  const pointerRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!activeDrag) return
    const handler = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', handler)
    return () => window.removeEventListener('pointermove', handler)
  }, [activeDrag])

  /** Resolve the current pointer position to a drop preview. */
  const computePreview = useCallback((): PaneDropPreview | null => {
    const pt = pointerRef.current
    const geom = geometryRef.current
    if (!geom) return null

    // Match against every registered pane. First hit on a tab-bar wins;
    // otherwise check content rects for zone-based split/move.
    for (const [paneId, g] of geom) {
      if (
        pt.x >= g.tabBarRect.left &&
        pt.x <= g.tabBarRect.left + g.tabBarRect.width &&
        pt.y >= g.tabBarRect.top &&
        pt.y <= g.tabBarRect.top + g.tabBarRect.height
      ) {
        const insertIndex = computeInsertIndex({ x: pt.x }, g.tabButtonRects)
        const kind = activeDrag?.paneId === paneId ? 'reorder' : 'move'
        return { kind, paneId, insertIndex }
      }
    }

    for (const [paneId, g] of geom) {
      if (
        pt.x >= g.contentRect.left &&
        pt.x <= g.contentRect.left + g.contentRect.width &&
        pt.y >= g.contentRect.top &&
        pt.y <= g.contentRect.top + g.contentRect.height
      ) {
        const zone = detectEdgeZone(pt, g.contentRect)
        if (zone === 'center') {
          // Append-to-pane semantics
          const insertIndex = g.tabButtonRects.length
          const kind = activeDrag?.paneId === paneId ? 'reorder' : 'move'
          return { kind, paneId, insertIndex }
        }
        const split = edgeToSplit(zone)
        if (!split) return null
        return { kind: 'split', paneId, direction: split.direction, placement: split.placement, zone }
      }
    }

    return null
  }, [activeDrag, geometryRef])

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as TabDragData | undefined
    if (!data) return
    setActiveDrag(data)
    setPreview(null)
  }, [])

  const handleDragMove = useCallback(
    (_e: DragMoveEvent) => {
      if (!activeDrag) return
      const next = computePreview()
      setPreview((prev) => (previewsEqual(prev, next) ? prev : next))
    },
    [activeDrag, computePreview]
  )

  const handleDragEnd = useCallback(
    (_e: DragEndEvent) => {
      const drag = activeDrag
      const current = preview
      setActiveDrag(null)
      setPreview(null)

      if (!drag) return

      if (!current) {
        // Dropped outside any pane — detach if pointer is well outside the window.
        const pt = pointerRef.current
        const margin = 30
        const out =
          pt.x < -margin || pt.y < -margin || pt.x > window.innerWidth + margin || pt.y > window.innerHeight + margin
        if (out) {
          detachTab(drag.paneId, drag.tabId)
        }
        return
      }

      if (current.kind === 'reorder') {
        // insertIndex is the target position; reorderTabsInPane takes (oldIndex, newIndex).
        const geom = geometryRef.current.get(current.paneId)
        if (!geom) return
        const fromIndex = geom.tabButtonRects.findIndex((r) => r.tabId === drag.tabId)
        if (fromIndex === -1) return
        const toIndex = current.insertIndex > fromIndex ? current.insertIndex - 1 : current.insertIndex
        reorderTabsInPane(current.paneId, fromIndex, toIndex)
        return
      }

      if (current.kind === 'move') {
        moveTabToPane(drag.paneId, drag.tabId, current.paneId, current.insertIndex)
        return
      }

      if (current.kind === 'split') {
        splitPaneWithTab(drag.paneId, drag.tabId, current.paneId, current.direction, current.placement)
      }
    },
    [activeDrag, preview, geometryRef, reorderTabsInPane, moveTabToPane, splitPaneWithTab, detachTab]
  )

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null)
    setPreview(null)
  }, [])

  const previewValue = useMemo<DropPreviewContextValue>(() => ({ preview }), [preview])

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}>
      <DropPreviewContext value={previewValue}>{children}</DropPreviewContext>
      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay dropAnimation={null}>{activeDrag && <TabDragGhost tab={activeDrag.tab} />}</DragOverlay>,
          document.body
        )}
    </DndContext>
  )
}

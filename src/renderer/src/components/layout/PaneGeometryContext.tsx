import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef } from 'react'

import type { RectLike } from '../../utils/paneDropDetection'

export interface PaneGeometry {
  /** The tab-bar strip's bounding rect (viewport coordinates). */
  tabBarRect: RectLike
  /** The pane's content area bounding rect (below the tab bar). */
  contentRect: RectLike
  /** Each TabButton's rect, in the order tabs are rendered. */
  tabButtonRects: Array<{ tabId: string; rect: RectLike }>
}

interface PaneGeometryContextValue {
  /** Mutable Map from paneId to its latest geometry. Read during drag in animation frames. */
  geometryRef: React.RefObject<Map<string, PaneGeometry>>
  register: (paneId: string, geometry: PaneGeometry) => void
  unregister: (paneId: string) => void
}

const PaneGeometryContext = createContext<PaneGeometryContextValue | null>(null)

/**
 * Pane geometry registry.
 *
 * Each `LeafPaneView` publishes its current tab-bar + content rects here so
 * drag-and-drop handlers can resolve "which pane is the pointer over?" without
 * querying the DOM on every pointer move. The registry is a ref-backed Map —
 * updates never trigger renders of subscribers; consumers (the DnD provider)
 * read `geometryRef.current` on demand.
 */
export function PaneGeometryProvider({ children }: { children: ReactNode }) {
  const geometryRef = useRef<Map<string, PaneGeometry>>(new Map())

  const register = useCallback((paneId: string, geometry: PaneGeometry) => {
    geometryRef.current.set(paneId, geometry)
  }, [])

  const unregister = useCallback((paneId: string) => {
    geometryRef.current.delete(paneId)
  }, [])

  const value = useMemo<PaneGeometryContextValue>(() => ({ geometryRef, register, unregister }), [register, unregister])

  return <PaneGeometryContext value={value}>{children}</PaneGeometryContext>
}

export function usePaneGeometry(): PaneGeometryContextValue {
  const ctx = use(PaneGeometryContext)
  if (!ctx) {
    throw new Error('usePaneGeometry must be used within a PaneGeometryProvider')
  }
  return ctx
}

/**
 * Convenience hook: register/unregister `paneId`'s geometry and keep it in sync.
 * Call the returned `update(next)` whenever any of the rects change (e.g.
 * inside a ResizeObserver). The registry is cleared on unmount.
 */
export function useRegisterPaneGeometry(paneId: string) {
  const { register, unregister } = usePaneGeometry()

  const update = useCallback(
    (geometry: PaneGeometry) => {
      register(paneId, geometry)
    },
    [register, paneId]
  )

  useEffect(() => {
    return () => unregister(paneId)
  }, [paneId, unregister])

  return update
}

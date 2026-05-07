import { useMiniApps } from '@renderer/hooks/useMiniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useCallback, useEffect, useState } from 'react'

/**
 * Owns the visible / hidden list state for the mini-app display settings panel.
 *
 * The panel only ever sees the region-filtered subset of mini-apps, so we use
 * command-style writes (`updateAppStatus` / `setAppStatusBulk`) — every PATCH
 * names exactly the rows that should change. Region-hidden rows are simply not
 * referenced and therefore never touched. The previous declarative
 * `updateMiniApps(newList)` API tried to infer "rows to disable" from the
 * difference against the full enabled set and would sweep CN-only apps into
 * `disabled` whenever the user touched the Global view.
 */
export function useMiniAppVisibility() {
  const { miniApps, disabled, updateAppStatus, setAppStatusBulk, reorderMiniAppsByStatus } = useMiniApps()

  const [visible, setVisible] = useState<MiniApp[]>(miniApps)
  const [hidden, setHidden] = useState<MiniApp[]>(disabled || [])

  // Resync local optimistic state with the upstream cache, but only when the
  // membership or order actually changed. Reordering goes through
  // `useReorder`, which writes an optimistic /mini-apps cache update — that
  // re-renders us with a fresh `miniApps` array reference whose IDs match
  // what we already have. Replacing local state with that fresh reference
  // mid-drop forces Sortable to re-layout while dnd-kit's drop animation is
  // still in flight, producing a visible "snap back to original position"
  // before the item lands at its target. Comparing by id sequence makes this
  // a no-op.
  useEffect(() => {
    setVisible((prev) => (sameAppIdSequence(prev, miniApps) ? prev : miniApps))
    setHidden((prev) => (sameAppIdSequence(prev, disabled || []) ? prev : disabled || []))
  }, [miniApps, disabled])

  const swap = useCallback(() => {
    const newVisible = hidden
    const newHidden = visible
    setVisible(newVisible)
    setHidden(newHidden)
    // Pinned rows are visible-by-design but should not be flipped to disabled
    // on swap; only the rows that were status='enabled' move into disabled.
    void setAppStatusBulk([
      ...visible.filter((a) => a.status === 'enabled').map((a) => ({ appId: a.appId, status: 'disabled' as const })),
      ...hidden.map((a) => ({ appId: a.appId, status: 'enabled' as const }))
    ])
  }, [hidden, visible, setAppStatusBulk])

  const reset = useCallback(() => {
    const newVisible = [...visible, ...hidden]
    setVisible(newVisible)
    setHidden([])
    // Promote everything currently hidden back to enabled — visible rows are
    // already enabled / pinned and are not touched.
    void setAppStatusBulk(hidden.map((a) => ({ appId: a.appId, status: 'enabled' as const })))
  }, [visible, hidden, setAppStatusBulk])

  const hide = useCallback(
    (app: MiniApp) => {
      setVisible((v) => v.filter((a) => a.appId !== app.appId))
      setHidden((h) => [...h, app])
      void updateAppStatus(app.appId, 'disabled')
    },
    [updateAppStatus]
  )

  const show = useCallback(
    (app: MiniApp) => {
      setHidden((h) => h.filter((a) => a.appId !== app.appId))
      setVisible((v) => [...v, app])
      void updateAppStatus(app.appId, 'enabled')
    },
    [updateAppStatus]
  )

  const reorderVisible = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const next = [...visible]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      setVisible(next)
      const partition = next.filter((a) => a.status === moved.status)
      void reorderMiniAppsByStatus(moved.status, partition)
    },
    [visible, reorderMiniAppsByStatus]
  )

  const reorderHidden = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const next = [...hidden]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      setHidden(next)
      void reorderMiniAppsByStatus('disabled', next)
    },
    [hidden, reorderMiniAppsByStatus]
  )

  return { visible, hidden, swap, reset, hide, show, reorderVisible, reorderHidden }
}

export type MiniAppVisibility = ReturnType<typeof useMiniAppVisibility>

function sameAppIdSequence(a: MiniApp[], b: MiniApp[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].appId !== b[i].appId) return false
  }
  return true
}

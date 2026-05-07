import { useMiniApps } from '@renderer/hooks/useMiniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useCallback, useEffect, useState } from 'react'

/**
 * Owns the visible/hidden list state for the mini-app display settings panel.
 *
 * Mirrors `useMiniApps` reads into local state so swap / reset / per-row
 * toggles can be optimistic, then writes back to DataApi via
 * `updateMiniApps` / `updateDisabledMiniApps` / `reorderMiniApps`.
 */
export function useMiniAppVisibility() {
  const { miniapps, disabled, updateMiniApps, updateDisabledMiniApps, reorderMiniAppsByStatus } = useMiniApps()

  const [visible, setVisible] = useState<MiniApp[]>(miniapps)
  const [hidden, setHidden] = useState<MiniApp[]>(disabled || [])

  useEffect(() => {
    setVisible(miniapps)
    setHidden(disabled || [])
  }, [miniapps, disabled])

  const swap = useCallback(() => {
    const newVisible = hidden
    const newHidden = visible
    setVisible(newVisible)
    setHidden(newHidden)
    void updateMiniApps(newVisible)
    void updateDisabledMiniApps(newHidden)
  }, [hidden, visible, updateMiniApps, updateDisabledMiniApps])

  const reset = useCallback(() => {
    setVisible(miniapps)
    setHidden([])
    void updateMiniApps(miniapps)
    void updateDisabledMiniApps([])
  }, [miniapps, updateMiniApps, updateDisabledMiniApps])

  const hide = useCallback(
    (app: MiniApp) => {
      const newVisible = visible.filter((a) => a.appId !== app.appId)
      const newHidden = [...hidden, app]
      setVisible(newVisible)
      setHidden(newHidden)
      void updateMiniApps(newVisible)
      void updateDisabledMiniApps(newHidden)
    },
    [visible, hidden, updateMiniApps, updateDisabledMiniApps]
  )

  const show = useCallback(
    (app: MiniApp) => {
      const newHidden = hidden.filter((a) => a.appId !== app.appId)
      const newVisible = [...visible, app]
      setVisible(newVisible)
      setHidden(newHidden)
      void updateMiniApps(newVisible)
      void updateDisabledMiniApps(newHidden)
    },
    [hidden, visible, updateMiniApps, updateDisabledMiniApps]
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

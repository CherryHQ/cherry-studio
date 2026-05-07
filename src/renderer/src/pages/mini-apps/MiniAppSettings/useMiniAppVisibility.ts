import { useMiniApps } from '@renderer/hooks/useMiniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Owns the visible/hidden list state for the mini-app display settings panel.
 *
 * Mirrors `useMiniApps` reads into local state so swap / reset / per-row
 * toggles can be optimistic, then writes back to DataApi via
 * `updateMiniApps` / `updateDisabledMiniApps` / `reorderMiniApps`.
 */
export function useMiniAppVisibility() {
  const { miniapps, disabled, allApps, updateMiniApps, updateDisabledMiniApps, reorderMiniAppsByStatus } = useMiniApps()

  const [visible, setVisible] = useState<MiniApp[]>(miniapps)
  const [hidden, setHidden] = useState<MiniApp[]>(disabled || [])

  useEffect(() => {
    setVisible(miniapps)
    setHidden(disabled || [])
  }, [miniapps, disabled])

  // The settings panel only shows apps that pass the region filter. The full
  // enabled/disabled sets in DataApi may include rows hidden by region — those
  // rows must be re-merged before persisting, otherwise updateMiniApps' diff
  // ("everything in `enabled` not in the input → disable") would silently
  // disable every region-hidden enabled row each time the user edits the
  // visible list. After switching the region back, those rows would resurface
  // as disabled.
  const { regionHiddenEnabled, regionHiddenDisabled } = useMemo(() => {
    const displayedIds = new Set<string>()
    for (const a of miniapps) displayedIds.add(a.appId)
    for (const a of disabled || []) displayedIds.add(a.appId)
    const enabledTail: MiniApp[] = []
    const disabledTail: MiniApp[] = []
    for (const a of allApps) {
      if (displayedIds.has(a.appId)) continue
      if (a.status === 'enabled') enabledTail.push(a)
      else if (a.status === 'disabled') disabledTail.push(a)
    }
    return { regionHiddenEnabled: enabledTail, regionHiddenDisabled: disabledTail }
  }, [allApps, miniapps, disabled])

  const persistVisible = useCallback(
    (next: MiniApp[]) => updateMiniApps([...next, ...regionHiddenEnabled]),
    [updateMiniApps, regionHiddenEnabled]
  )
  const persistHidden = useCallback(
    (next: MiniApp[]) => updateDisabledMiniApps([...next, ...regionHiddenDisabled]),
    [updateDisabledMiniApps, regionHiddenDisabled]
  )

  const swap = useCallback(() => {
    const newVisible = hidden
    const newHidden = visible
    setVisible(newVisible)
    setHidden(newHidden)
    void persistVisible(newVisible)
    void persistHidden(newHidden)
  }, [hidden, visible, persistVisible, persistHidden])

  const reset = useCallback(() => {
    setVisible(miniapps)
    setHidden([])
    void persistVisible(miniapps)
    void persistHidden([])
  }, [miniapps, persistVisible, persistHidden])

  const hide = useCallback(
    (app: MiniApp) => {
      const newVisible = visible.filter((a) => a.appId !== app.appId)
      const newHidden = [...hidden, app]
      setVisible(newVisible)
      setHidden(newHidden)
      void persistVisible(newVisible)
      void persistHidden(newHidden)
    },
    [visible, hidden, persistVisible, persistHidden]
  )

  const show = useCallback(
    (app: MiniApp) => {
      const newHidden = hidden.filter((a) => a.appId !== app.appId)
      const newVisible = [...visible, app]
      setVisible(newVisible)
      setHidden(newHidden)
      void persistVisible(newVisible)
      void persistHidden(newHidden)
    },
    [hidden, visible, persistVisible, persistHidden]
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

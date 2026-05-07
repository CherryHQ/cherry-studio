import { loggerService } from '@logger'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { isDataApiError, toDataApiError } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useMiniAppVisibility')

/**
 * Surface partial-failure errors from `setAppStatusBulk` /
 * `updateAppStatus` / `reorderMiniAppsByStatus` to the user. Without this,
 * upstream's `settleAndInvalidate` (which throws + invalidates the cache)
 * would be swallowed by the `void`-fired call sites — the optimistic UI
 * snaps back to the cache value with no toast, leaving the user wondering
 * what happened.
 */
function reportFailure(t: (key: string) => string, fallbackKey: string) {
  return (err: unknown) => {
    const e = toDataApiError(err)
    if (isDataApiError(e)) {
      logger.error('mutation failed', { code: e.code, message: e.message })
      window.toast?.error?.(e.message || t(fallbackKey))
    } else {
      logger.error('mutation failed', err as Error)
      window.toast?.error?.(t(fallbackKey))
    }
  }
}

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
  const { t } = useTranslation()
  const { miniApps, disabled, updateAppStatus, setAppStatusBulk, reorderMiniAppsByStatus } = useMiniApps()

  const [visible, setVisible] = useState<MiniApp[]>(miniApps)
  const [hidden, setHidden] = useState<MiniApp[]>(disabled || [])

  // Resync local optimistic state with the upstream cache, but skip the resync
  // when the membership / order / status of every row is unchanged. Reordering
  // goes through `useReorder`, which writes an optimistic /mini-apps cache
  // update — replacing local state with that fresh reference mid-drop forces
  // Sortable to re-layout while dnd-kit's drop animation is still in flight,
  // producing a visible "snap back" before the item lands at its target.
  //
  // Compare by (appId, status) — id alone is too lax: a status flip from a
  // sibling action (e.g. right-clicking an app and picking "Add to Launchpad"
  // while this panel is open) leaves the membership identical but changes
  // status, and the local row's stale `status` then misclassifies the row in
  // `swap`/`reset`/`reorderVisible` filters that key off `a.status`.
  useEffect(() => {
    setVisible((prev) => (sameRowsByIdAndStatus(prev, miniApps) ? prev : miniApps))
    setHidden((prev) => (sameRowsByIdAndStatus(prev, disabled || []) ? prev : disabled || []))
  }, [miniApps, disabled])

  const swap = useCallback(() => {
    // Pinned rows are visible-by-design and the bulk update below intentionally
    // skips them. Mirror that filter in the optimistic state too — otherwise
    // pinned rows briefly appear in `hidden`, then snap back to `visible` after
    // the next cache invalidate revalidates the truth from DB.
    const movingToHidden = visible.filter((a) => a.status === 'enabled')
    const pinnedStays = visible.filter((a) => a.status === 'pinned')
    setVisible([...hidden, ...pinnedStays])
    setHidden(movingToHidden)
    setAppStatusBulk([
      ...movingToHidden.map((a) => ({ appId: a.appId, status: 'disabled' as const })),
      ...hidden.map((a) => ({ appId: a.appId, status: 'enabled' as const }))
    ]).catch(reportFailure(t, 'miniApps.update_partial_failure_generic'))
  }, [hidden, visible, setAppStatusBulk, t])

  const reset = useCallback(() => {
    const newVisible = [...visible, ...hidden]
    setVisible(newVisible)
    setHidden([])
    // Promote everything currently hidden back to enabled — visible rows are
    // already enabled / pinned and are not touched.
    setAppStatusBulk(hidden.map((a) => ({ appId: a.appId, status: 'enabled' as const }))).catch(
      reportFailure(t, 'miniApps.update_partial_failure_generic')
    )
  }, [visible, hidden, setAppStatusBulk, t])

  const hide = useCallback(
    (app: MiniApp) => {
      setVisible((v) => v.filter((a) => a.appId !== app.appId))
      setHidden((h) => [...h, app])
      updateAppStatus(app.appId, 'disabled').catch(reportFailure(t, 'miniApp.hide_failed'))
    },
    [updateAppStatus, t]
  )

  const show = useCallback(
    (app: MiniApp) => {
      setHidden((h) => h.filter((a) => a.appId !== app.appId))
      setVisible((v) => [...v, app])
      updateAppStatus(app.appId, 'enabled').catch(reportFailure(t, 'miniApp.show_failed'))
    },
    [updateAppStatus, t]
  )

  const reorderVisible = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const next = [...visible]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      setVisible(next)
      const partition = next.filter((a) => a.status === moved.status)
      reorderMiniAppsByStatus(moved.status, partition).catch(reportFailure(t, 'miniApp.reorder_failed'))
    },
    [visible, reorderMiniAppsByStatus, t]
  )

  const reorderHidden = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const next = [...hidden]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      setHidden(next)
      reorderMiniAppsByStatus('disabled', next).catch(reportFailure(t, 'miniApp.reorder_failed'))
    },
    [hidden, reorderMiniAppsByStatus, t]
  )

  return { visible, hidden, swap, reset, hide, show, reorderVisible, reorderHidden }
}

export type MiniAppVisibility = ReturnType<typeof useMiniAppVisibility>

function sameRowsByIdAndStatus(a: MiniApp[], b: MiniApp[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].appId !== b[i].appId) return false
    if (a[i].status !== b[i].status) return false
  }
  return true
}

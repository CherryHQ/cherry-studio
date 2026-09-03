import { loggerService } from '@logger'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { toast } from '@renderer/services/toast'
import { isDataApiError, toDataApiError } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useCallback, useEffect, useRef, useState } from 'react'
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
      toast.error(e.message || t(fallbackKey))
    } else {
      logger.error('mutation failed', err as Error)
      toast.error(t(fallbackKey))
    }
  }
}

function withEnabledStatus(app: MiniApp): MiniApp {
  return app.status === 'enabled' ? app : { ...app, status: 'enabled' }
}

function isVisibleMiniApp(app: MiniApp): boolean {
  return app.status === 'enabled' || app.status === 'pinned'
}

/** Insert `app` before its first original successor or a row introduced after the snapshot. */
function insertMiniAppInOriginalOrder(
  visible: MiniApp[],
  app: MiniApp,
  originalVisibleIds: readonly string[]
): MiniApp[] {
  const origIndex = originalVisibleIds.indexOf(app.appId)
  if (origIndex < 0) return [...visible, app]
  const insertAt = visible.findIndex((item) => {
    const itemIndex = originalVisibleIds.indexOf(item.appId)
    return itemIndex < 0 || itemIndex > origIndex
  })
  if (insertAt < 0) return [...visible, app]
  const next = visible.slice()
  next.splice(insertAt, 0, app)
  return next
}

/** Visible subsequence follows `nextVisibleIds`; still-hidden ids keep their previous slots. */
function withUpdatedVisibleOrder(originalVisibleIds: readonly string[], nextVisibleIds: readonly string[]): string[] {
  const nextIds = new Set(nextVisibleIds)
  let nextIndex = 0
  const nextRanking: string[] = []
  for (const appId of originalVisibleIds) {
    if (!nextIds.has(appId)) {
      nextRanking.push(appId)
      continue
    }
    nextRanking.push(nextVisibleIds[nextIndex++])
  }
  if (nextIndex < nextVisibleIds.length) {
    nextRanking.push(...nextVisibleIds.slice(nextIndex))
  }
  return nextRanking
}

function restoreHiddenMiniApps(
  visible: MiniApp[],
  hidden: MiniApp[],
  originalVisibleIds: readonly string[]
): MiniApp[] {
  const originalRanks = new Map(originalVisibleIds.map((appId, index) => [appId, index]))
  const known = [
    ...visible.filter((app) => originalRanks.has(app.appId)),
    ...hidden.filter((app) => originalRanks.has(app.appId)).map(withEnabledStatus)
  ].sort((a, b) => originalRanks.get(a.appId)! - originalRanks.get(b.appId)!)
  const introducedVisible = visible.filter((app) => !originalRanks.has(app.appId))
  const introducedHidden = hidden.filter((app) => !originalRanks.has(app.appId)).map(withEnabledStatus)
  return [...known, ...introducedVisible, ...introducedHidden]
}

function restoredOrderAnchor(
  appId: string,
  originalVisibleIds: readonly string[],
  allApps: readonly MiniApp[],
  restoringIds: ReadonlySet<string>
): OrderRequest {
  const originalIndex = originalVisibleIds.indexOf(appId)
  if (originalIndex < 0) return { position: 'last' }

  const destinationIds = allApps
    .filter((app) => app.appId !== appId && !restoringIds.has(app.appId) && isVisibleMiniApp(app))
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
    .map((app) => app.appId)
  const destinationIdSet = new Set(destinationIds)
  const originalSuccessor = originalVisibleIds.slice(originalIndex + 1).find((id) => destinationIdSet.has(id))
  if (originalSuccessor) return { before: originalSuccessor }

  const originalIdSet = new Set(originalVisibleIds)
  const introducedSuccessor = destinationIds.find((id) => !originalIdSet.has(id))
  return introducedSuccessor ? { before: introducedSuccessor } : { position: 'last' }
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
  const { allApps, miniApps, disabled, effectiveRegion, updateAppStatus, setAppStatusBulk, reorderMiniAppsByStatus } =
    useMiniApps()

  const [visible, setVisible] = useState<MiniApp[]>(miniApps)
  const [hidden, setHidden] = useState<MiniApp[]>(disabled || [])
  // Snapshot the first visible ranking so hide/show is not a reorder.
  const originalVisibleIdsRef = useRef<string[]>([])
  const originalVisibleRegionRef = useRef(effectiveRegion)
  const pendingShownIdsRef = useRef(new Set<string>())

  const enqueueMutation = useCallback(
    (mutation: () => Promise<unknown>, fallbackKey: string, onFailure?: () => void) => {
      void mutation().catch((error) => {
        onFailure?.()
        reportFailure(t, fallbackKey)(error)
      })
    },
    [t]
  )

  useEffect(() => {
    const visibleIds = allApps
      .filter(isVisibleMiniApp)
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
      .map((app) => app.appId)
    if (originalVisibleRegionRef.current !== effectiveRegion) {
      originalVisibleRegionRef.current = effectiveRegion
      originalVisibleIdsRef.current = visibleIds
    } else if (originalVisibleIdsRef.current.length === 0 && visibleIds.length > 0) {
      originalVisibleIdsRef.current = visibleIds
    }
  }, [allApps, effectiveRegion])

  useEffect(() => {
    for (const app of allApps) {
      if (isVisibleMiniApp(app)) pendingShownIdsRef.current.delete(app.appId)
    }
  }, [allApps])

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
  // `swap` / `reset` / `reorderVisible` filters that key off `a.status`.
  useEffect(() => {
    setVisible((prev) => (sameRowsByIdAndStatus(prev, miniApps) ? prev : miniApps))
    setHidden((prev) => (sameRowsByIdAndStatus(prev, disabled || []) ? prev : disabled || []))
  }, [miniApps, disabled])

  const swap = useCallback(() => {
    // Pinned rows are visible-by-design and the bulk update below intentionally
    // skips them. Mirror that filter in the optimistic state, AND put pinned
    // at the head of the new visible list — after the PATCH lands, the
    // service tail-assigns new orderKeys to the rows whose status flipped, so
    // the formerly-hidden rows sort to the bottom of `miniApps` while pinned
    // (whose orderKeys are unchanged) sort near the top. Matching that order
    // here keeps the resync a no-op and avoids the brief jump where pinned
    // would otherwise appear at the bottom for one render before snapping
    // back to the top.
    const movingToHidden = visible.filter((a) => a.status === 'enabled')
    const pinnedStays = visible.filter((a) => a.status === 'pinned')
    setVisible([...pinnedStays, ...hidden])
    setHidden(movingToHidden)
    enqueueMutation(
      () =>
        setAppStatusBulk([
          ...movingToHidden.map((a) => ({ appId: a.appId, status: 'disabled' as const })),
          ...hidden.map((a) => ({ appId: a.appId, status: 'enabled' as const }))
        ]),
      'miniApps.update_partial_failure_generic'
    )
  }, [enqueueMutation, hidden, visible, setAppStatusBulk])

  const reset = useCallback(() => {
    const newVisible = restoreHiddenMiniApps(visible, hidden, originalVisibleIdsRef.current)
    const restoringIds = new Set(hidden.map((app) => app.appId))
    setVisible(newVisible)
    setHidden([])
    const updates = newVisible
      .filter((app) => restoringIds.has(app.appId))
      .map((app) => ({
        appId: app.appId,
        status: 'enabled' as const,
        order: restoredOrderAnchor(app.appId, originalVisibleIdsRef.current, allApps, restoringIds)
      }))
    enqueueMutation(() => setAppStatusBulk(updates), 'miniApps.update_partial_failure_generic')
  }, [allApps, enqueueMutation, visible, hidden, setAppStatusBulk])

  const hide = useCallback(
    (app: MiniApp) => {
      pendingShownIdsRef.current.delete(app.appId)
      setVisible((v) => v.filter((a) => a.appId !== app.appId))
      setHidden((h) => [...h, app])
      enqueueMutation(() => updateAppStatus(app.appId, 'disabled'), 'miniApp.hide_failed')
    },
    [enqueueMutation, updateAppStatus]
  )

  const show = useCallback(
    (app: MiniApp) => {
      const enabledApp = withEnabledStatus(app)
      pendingShownIdsRef.current.add(app.appId)
      setHidden((h) => h.filter((a) => a.appId !== app.appId))
      setVisible((current) => insertMiniAppInOriginalOrder(current, enabledApp, originalVisibleIdsRef.current))

      enqueueMutation(
        () =>
          updateAppStatus(app.appId, 'enabled', (currentApps) => {
            const optimisticApps = currentApps.map((item) =>
              pendingShownIdsRef.current.has(item.appId) ? withEnabledStatus(item) : item
            )
            return restoredOrderAnchor(app.appId, originalVisibleIdsRef.current, optimisticApps, new Set([app.appId]))
          }),
        'miniApp.show_failed',
        () => pendingShownIdsRef.current.delete(app.appId)
      )
    },
    [enqueueMutation, updateAppStatus]
  )

  const reorderVisible = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const next = [...visible]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      const previousOriginalOrder = originalVisibleIdsRef.current
      const nextOriginalOrder = withUpdatedVisibleOrder(
        originalVisibleIdsRef.current,
        next.map((app) => app.appId)
      )
      originalVisibleIdsRef.current = nextOriginalOrder
      setVisible(next)
      enqueueMutation(
        () => reorderMiniAppsByStatus('visible', next),
        'miniApp.reorder_failed',
        () => {
          if (originalVisibleIdsRef.current === nextOriginalOrder) {
            originalVisibleIdsRef.current = previousOriginalOrder
          }
        }
      )
    },
    [enqueueMutation, visible, reorderMiniAppsByStatus]
  )

  const reorderHidden = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const next = [...hidden]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      setHidden(next)
      enqueueMutation(() => reorderMiniAppsByStatus('disabled', next), 'miniApp.reorder_failed')
    },
    [enqueueMutation, hidden, reorderMiniAppsByStatus]
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

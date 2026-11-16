import { useEffect, useRef } from 'react'

import { useTabs } from '@renderer/hooks/tab'
import {
  type AnalyticsView,
  attachPageDwellTracker,
  installUiClickTracker,
  PageDwellTracker,
  setUsageAnalyticsPage,
  toAnalyticsPage
} from '@renderer/services/usageAnalytics'
import type { AnalyticsPage } from '@shared/ipc/schemas/analytics'

function usePageDwellTracker() {
  const trackerRef = useRef<PageDwellTracker | null>(null)
  useEffect(() => {
    const tracker = new PageDwellTracker(undefined, undefined, {
      focused: document.hasFocus(),
      visible: document.visibilityState === 'visible'
    })
    trackerRef.current = tracker
    const detach = attachPageDwellTracker(tracker)
    return () => {
      detach()
      tracker.end('app_quit')
      trackerRef.current = null
    }
  }, [])
  return trackerRef
}

/** Times the active tab only, so background tabs never accrue time; clicks are attributed to its page. */
export function useTabDwellTracking(enabled: boolean): void {
  const { tabs, activeTab } = useTabs()
  const trackerRef = usePageDwellTracker()
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const previousTabIdRef = useRef<string | null>(null)

  useEffect(() => {
    const tracker = trackerRef.current
    if (!tracker) return
    const view: AnalyticsView | null =
      enabled && activeTab ? { key: activeTab.id, ...toAnalyticsPage(activeTab) } : null
    const previousId = previousTabIdRef.current
    const switched = previousId !== null && view !== null && previousId !== view.key
    const reason = !switched
      ? 'navigate'
      : tabsRef.current.some((tab) => tab.id === previousId)
        ? 'tab_switch'
        : 'tab_close'
    tracker.show(view, reason)
    previousTabIdRef.current = view?.key ?? null
    setUsageAnalyticsPage(view?.page ?? 'other')
  }, [activeTab, enabled, trackerRef])
}

/** Times a single-surface window such as the quick assistant while it is visible. */
export function useWindowDwellTracking(page: AnalyticsPage): void {
  const trackerRef = usePageDwellTracker()
  useEffect(() => {
    trackerRef.current?.show({ key: page, page }, 'navigate')
  }, [page, trackerRef])
}

/** Installs this window's click reporting once; `page` fixes attribution for windows without tabs. */
export function useUiClickTracking(page?: AnalyticsPage): void {
  useEffect(() => {
    if (page) setUsageAnalyticsPage(page)
    return installUiClickTracker()
  }, [page])
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { cacheService } from '@renderer/data/CacheService'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useOptionalTabsContext, useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { miniAppWebviewService, type MiniAppDemand } from '@renderer/services/MiniAppWebviewService'
import { toTransientMiniApp } from '@renderer/utils/miniAppDescriptor'
import { DEFAULT_MAX_KEEP_ALIVE_MINI_APPS, miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'

export function useMiniAppRuntime() {
  const resources = useSyncExternalStore(miniAppWebviewService.subscribe, miniAppWebviewService.getSnapshot)
  const tabs = useOptionalTabsContext()
  const currentMiniAppId = miniAppIdFromTabUrl(tabs?.activeTab?.url) ?? ''
  const secondary = tabs?.secondaryPane
  return {
    resources,
    openedKeepAliveMiniApps: useMemo(() => resources.map((resource) => resource.app), [resources]),
    currentMiniAppId,
    miniAppShow: !!currentMiniAppId,
    splitOpen: !!secondary,
    splitMiniAppId: miniAppIdFromTabUrl(tabs?.tabs.find((tab) => tab.id === secondary?.tabId)?.url) ?? ''
  }
}

/** Mounted once outside page Activities; page subscriptions never own guests. */
export function useMiniAppRuntimeBinding(): void {
  const { tabs, activeTabId, secondaryPane, closeTabs } = useTabs()
  const { data: apps } = useQuery('/mini-apps')
  const previousCatalog = useRef(apps)
  const [capacity] = usePreference('feature.mini_app.max_keep_alive')
  const appIds = useMemo(
    () => [
      ...new Set(
        tabs.flatMap((tab) => {
          const id = miniAppIdFromTabUrl(tab.url)
          return id ? [id] : []
        })
      )
    ],
    [tabs]
  )
  const subscribeDescriptors = useCallback(
    (listener: () => void) => {
      const disposables = appIds.map((id) => cacheService.subscribe(`mini_app.transient_descriptor.${id}`, listener))
      disposables.push(cacheService.onSharedCacheReady(listener))
      return () => disposables.forEach((dispose) => dispose())
    },
    [appIds]
  )
  const readDescriptors = useCallback(
    () => JSON.stringify(appIds.map((id) => cacheService.getSharedSnapshot(`mini_app.transient_descriptor.${id}`))),
    [appIds]
  )
  const descriptors = useSyncExternalStore(subscribeDescriptors, readDescriptors)

  useLayoutEffect(() => {
    const removed = new Set(
      previousCatalog.current
        ?.filter((previous) => {
          const current = apps?.find((app) => app.appId === previous.appId)
          return apps !== undefined && !current
        })
        .map((app) => app.appId)
    )
    if (apps !== undefined) previousCatalog.current = apps
    const removedTabs = tabs.filter((tab) => removed.has(miniAppIdFromTabUrl(tab.url) ?? ''))
    if (removedTabs.length) closeTabs(removedTabs.map((tab) => tab.id))
    const demands = new Map<string, MiniAppDemand>()
    for (const tab of tabs) {
      const appId = miniAppIdFromTabUrl(tab.url)
      if (!appId || removed.has(appId)) continue
      const existing = demands.get(appId)
      const descriptor = cacheService.getSharedSnapshot(`mini_app.transient_descriptor.${appId}`)
      const app =
        apps?.find((item) => item.appId === appId) ?? (descriptor ? toTransientMiniApp(descriptor) : undefined)
      const visible = tab.id === activeTabId || tab.id === secondaryPane?.tabId
      demands.set(appId, {
        appId,
        app,
        awake: visible || !tab.isDormant || !!existing?.awake,
        visible: visible || !!existing?.visible,
        protected: (!tab.isDormant && !!tab.isPinned) || !!existing?.protected,
        lastAccessTime: Math.max(tab.lastAccessTime ?? 0, existing?.lastAccessTime ?? 0)
      })
    }
    miniAppWebviewService.sync([...demands.values()], capacity ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS)
  }, [tabs, activeTabId, secondaryPane, apps, descriptors, capacity, closeTabs])

  useIpcOn('mini_app.runtime.evicted', ({ appId }) => {
    closeTabs(tabs.filter((tab) => miniAppIdFromTabUrl(tab.url) === appId).map((tab) => tab.id))
  })
  useEffect(() => () => miniAppWebviewService.dispose(), [])
}

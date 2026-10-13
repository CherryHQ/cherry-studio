import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { useCache, useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useOptionalTabsContext, useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { webviewRuntimeService, type WebviewRequest } from '@renderer/services/WebviewRuntimeService'
import { toTransientMiniApp } from '@renderer/utils/miniAppDescriptor'
import {
  DEFAULT_MAX_KEEP_ALIVE_MINI_APPS,
  miniAppIdFromTabUrl,
  miniAppResourceKey
} from '@renderer/utils/miniAppKeepAlive'

function useMiniAppDescriptors(appIds: string[]) {
  const { data: apps } = useQuery('/mini-apps')
  const descriptors = useSharedCacheSelector(
    appIds.map((id) => `mini_app.transient_descriptor.${id}` as const),
    (values) => values
  )
  const byId = useMemo(
    () =>
      new Map(
        appIds.map((id, index) => {
          const descriptor = descriptors[index]
          return [
            id,
            apps?.find((app) => app.appId === id) ?? (descriptor ? toTransientMiniApp(descriptor) : undefined)
          ]
        })
      ),
    [appIds, apps, descriptors]
  )
  return { apps, byId }
}

function useMiniAppLayout() {
  const tabs = useOptionalTabsContext()
  const [split, setSplit] = useCache('mini_app.split')
  const currentMiniAppId = miniAppIdFromTabUrl(tabs?.activeTab?.url) ?? ''
  const secondary = tabs?.tabs.find((tab) => tab.id === split?.tabId)
  const secondaryAppId = miniAppIdFromTabUrl(secondary?.url)
  const splitOpen =
    !!currentMiniAppId && !!split && (split.tabId === null || (!!secondaryAppId && secondaryAppId !== currentMiniAppId))
  return {
    split,
    setSplit,
    currentMiniAppId,
    splitOpen,
    splitMiniAppId: splitOpen ? (secondaryAppId ?? '') : ''
  }
}

export function useMiniAppRuntime() {
  const resources = useSyncExternalStore(webviewRuntimeService.subscribe, webviewRuntimeService.getSnapshot)
  const layout = useMiniAppLayout()
  const appIds = useMemo(() => resources.map((resource) => resource.key.slice('miniapp:'.length)), [resources])
  const { byId } = useMiniAppDescriptors(appIds)
  return {
    resources,
    openedKeepAliveMiniApps: useMemo(() => [...byId.values()].filter((app) => app !== undefined), [byId]),
    currentMiniAppId: layout.currentMiniAppId,
    miniAppShow: !!layout.currentMiniAppId,
    splitOpen: layout.splitOpen,
    splitMiniAppId: layout.splitMiniAppId
  }
}

export function useMiniAppWebview(appId: string) {
  const read = useCallback(() => webviewRuntimeService.get(miniAppResourceKey(appId)), [appId])
  return useSyncExternalStore(webviewRuntimeService.subscribe, read)
}

/** Mounted once outside page Activities; page subscriptions never own guests. */
export function useMiniAppRuntimeBinding(): void {
  const { tabs, activeTabId, closeTabs } = useTabs()
  const { split, setSplit, currentMiniAppId, splitOpen } = useMiniAppLayout()
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
  const { apps, byId } = useMiniAppDescriptors(appIds)
  const previousCatalog = useRef(apps)

  useLayoutEffect(() => {
    if (!split?.tabId) return
    const secondaryAppId = miniAppIdFromTabUrl(tabs.find((tab) => tab.id === split.tabId)?.url)
    if (!secondaryAppId || secondaryAppId === currentMiniAppId) setSplit(null)
  }, [tabs, split, currentMiniAppId, setSplit])

  useLayoutEffect(() => {
    const removed = new Set(
      previousCatalog.current
        ?.filter((previous) => apps !== undefined && !apps.some((app) => app.appId === previous.appId))
        .map((app) => app.appId)
    )
    if (apps !== undefined) previousCatalog.current = apps
    const removedTabs = tabs.filter((tab) => removed.has(miniAppIdFromTabUrl(tab.url) ?? ''))
    if (removedTabs.length) closeTabs(removedTabs.map((tab) => tab.id))
    const requests = new Map<string, WebviewRequest>()
    for (const tab of tabs) {
      const appId = miniAppIdFromTabUrl(tab.url)
      if (!appId || removed.has(appId)) continue
      const key = miniAppResourceKey(appId)
      const existing = requests.get(key)
      const app = byId.get(appId)
      requests.set(key, {
        key,
        source: app
          ? { src: app.url, partition: app.kind === 'app' ? `persist:miniapp:${appId}` : 'persist:webview' }
          : undefined,
        visible: tab.id === activeTabId || (splitOpen && tab.id === split?.tabId) || !!existing?.visible,
        protected: !!tab.isPinned || !!existing?.protected,
        lastAccessTime: Math.max(tab.lastAccessTime ?? 0, existing?.lastAccessTime ?? 0)
      })
    }
    webviewRuntimeService.sync([...requests.values()], capacity ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS)
  }, [tabs, activeTabId, split, splitOpen, apps, byId, capacity, closeTabs])

  useIpcOn('mini_app.runtime.evicted', ({ appId }) => {
    closeTabs(tabs.filter((tab) => miniAppIdFromTabUrl(tab.url) === appId).map((tab) => tab.id))
  })
  useEffect(() => () => webviewRuntimeService.dispose(), [])
}

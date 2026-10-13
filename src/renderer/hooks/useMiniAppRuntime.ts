import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { useCache, useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useOptionalTabsContext, useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { webviewRuntimeService } from '@renderer/services/WebviewRuntimeService'
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
  const splitOpen = !!currentMiniAppId && !!split && split.appId !== currentMiniAppId
  const splitMiniAppId = splitOpen ? (split.appId ?? '') : ''
  const appIds = useMemo(
    () => [
      ...new Set([
        ...(tabs?.tabs.flatMap((tab) => {
          const id = miniAppIdFromTabUrl(tab.url)
          return id ? [id] : []
        }) ?? []),
        ...(splitMiniAppId ? [splitMiniAppId] : [])
      ])
    ],
    [tabs?.tabs, splitMiniAppId]
  )
  return {
    split,
    setSplit,
    currentMiniAppId,
    splitOpen,
    splitMiniAppId,
    appIds
  }
}

export function useMiniAppRuntime() {
  const resources = useSyncExternalStore(webviewRuntimeService.subscribe, webviewRuntimeService.getSnapshot)
  const layout = useMiniAppLayout()
  const { byId } = useMiniAppDescriptors(layout.appIds)
  const guests = useMemo(() => {
    const appsByKey = new Map([...byId].map(([appId, app]) => [miniAppResourceKey(appId), app]))
    return resources.flatMap((resource) => {
      const app = appsByKey.get(resource.key)
      return app ? [{ resource, app }] : []
    })
  }, [resources, byId])
  return {
    guests,
    openedKeepAliveMiniApps: useMemo(() => guests.map(({ app }) => app), [guests]),
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
  const { split, setSplit, splitMiniAppId, appIds } = useMiniAppLayout()
  const [capacity] = usePreference('feature.mini_app.max_keep_alive')
  const { apps, byId } = useMiniAppDescriptors(appIds)
  const previousCatalog = useRef(apps)

  useLayoutEffect(() => {
    const removed = new Set(
      previousCatalog.current
        ?.filter((previous) => apps !== undefined && !apps.some((app) => app.appId === previous.appId))
        .map((app) => app.appId)
    )
    if (apps !== undefined) previousCatalog.current = apps
    const removedTabs = tabs.filter((tab) => removed.has(miniAppIdFromTabUrl(tab.url) ?? ''))
    if (removedTabs.length) closeTabs(removedTabs.map((tab) => tab.id))
    if (split?.appId && removed.has(split.appId)) setSplit(null)
    const requests = appIds
      .filter((appId) => !removed.has(appId))
      .map((appId) => {
        const owners = tabs.filter((tab) => miniAppIdFromTabUrl(tab.url) === appId)
        const app = byId.get(appId)
        return {
          key: miniAppResourceKey(appId),
          source: app
            ? { src: app.url, partition: app.kind === 'app' ? `persist:miniapp:${appId}` : 'persist:webview' }
            : undefined,
          visible: appId === splitMiniAppId || owners.some((tab) => tab.id === activeTabId),
          protected: owners.some((tab) => !!tab.isPinned),
          lastAccessTime: Math.max(0, ...owners.map((tab) => tab.lastAccessTime ?? 0))
        }
      })
    webviewRuntimeService.sync(requests, capacity ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS)
  }, [tabs, activeTabId, split, setSplit, splitMiniAppId, appIds, apps, byId, capacity, closeTabs])

  useIpcOn('mini_app.runtime.evicted', ({ appId }) => {
    if (split?.appId === appId) setSplit(null)
    closeTabs(tabs.filter((tab) => miniAppIdFromTabUrl(tab.url) === appId).map((tab) => tab.id))
  })
  useLayoutEffect(() => () => webviewRuntimeService.dispose(), [])
}

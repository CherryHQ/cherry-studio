import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { useCache, useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useOptionalTabsContext, useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { trackProductEvent } from '@renderer/services/productAnalytics'
import { webviewRuntimeService } from '@renderer/services/WebviewRuntimeService'
import { toTransientMiniApp } from '@renderer/utils/miniAppDescriptor'
import {
  DEFAULT_MAX_KEEP_ALIVE_MINI_APPS,
  miniAppIdFromResourceKey,
  miniAppIdFromTabUrl,
  miniAppResourceKey
} from '@renderer/utils/miniAppKeepAlive'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'

// Built-in ids the analytics catalog accepts as a target; a mixed-case preset id such as 'Felo' would be rejected.
const BUILTIN_MINI_APP_TARGETS = new Set(
  PRESETS_MINI_APPS.map((app) => app.id).filter((id) => /^[a-z0-9][a-z0-9:._-]{0,119}$/.test(id))
)

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
  const resources = useSyncExternalStore(webviewRuntimeService.subscribe, webviewRuntimeService.getSnapshot)
  const tabs = useOptionalTabsContext()
  const [split, setSplit] = useCache('mini_app.split')
  const currentMiniAppId = miniAppIdFromTabUrl(tabs?.activeTab?.url) ?? ''
  const splitOpen = !!currentMiniAppId && !!split && split.appId !== currentMiniAppId
  const splitMiniAppId = splitOpen ? (split.appId ?? '') : ''
  const appIds = useMemo(
    () => [
      ...new Set([
        ...resources.map((resource) => miniAppIdFromResourceKey(resource.key)),
        ...(tabs?.tabs.flatMap((tab) => {
          const id = miniAppIdFromTabUrl(tab.url)
          return id ? [id] : []
        }) ?? []),
        ...(splitMiniAppId ? [splitMiniAppId] : [])
      ])
    ],
    [tabs?.tabs, splitMiniAppId, resources]
  )
  return {
    split,
    setSplit,
    currentMiniAppId,
    splitOpen,
    splitMiniAppId,
    appIds,
    resources
  }
}

export function useMiniAppRuntime() {
  const layout = useMiniAppLayout()
  const { resources } = layout
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
  const { split, setSplit, splitMiniAppId, appIds, resources } = useMiniAppLayout()
  const [capacity] = usePreference('feature.mini_app.max_keep_alive')
  const { apps, byId } = useMiniAppDescriptors(appIds)
  const previousCatalog = useRef(apps)
  const previousTabs = useRef(tabs)
  const previousSplitAppId = useRef(split?.appId)

  useLayoutEffect(() => {
    const closed = new Set(
      previousTabs.current
        .filter((tab) => !tabs.some((current) => current.id === tab.id))
        .map((tab) => miniAppIdFromTabUrl(tab.url))
    )
    if (previousSplitAppId.current && previousSplitAppId.current !== split?.appId) {
      closed.add(previousSplitAppId.current)
    }
    previousTabs.current = tabs
    previousSplitAppId.current = split?.appId
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
      .flatMap((appId) => {
        const owners = tabs.filter((tab) => miniAppIdFromTabUrl(tab.url) === appId)
        if (closed.has(appId) && owners.length === 0 && appId !== splitMiniAppId) return []
        const app = byId.get(appId)
        const existing = resources.find((resource) => resource.key === miniAppResourceKey(appId))
        const visible = appId === splitMiniAppId || owners.some((tab) => tab.id === activeTabId)
        return [
          {
            key: miniAppResourceKey(appId),
            source: app
              ? { src: app.url, partition: app.kind === 'app' ? `persist:miniapp:${appId}` : 'persist:webview' }
              : undefined,
            visible,
            protected: owners.some((tab) => !!tab.isPinned),
            lastAccessTime: Math.max(
              existing?.lastAccessTime ?? 0,
              visible && !existing?.visible ? Date.now() : 0,
              ...owners.map((tab) => tab.lastAccessTime ?? 0)
            )
          }
        ]
      })
    for (const request of requests) {
      // A guest the runtime is about to create, i.e. the app was not already open in this window.
      if (!request.visible || !request.source || resources.some((resource) => resource.key === request.key)) continue
      const presetId = byId.get(miniAppIdFromResourceKey(request.key))?.presetMiniAppId
      trackProductEvent({
        event: 'feature_used',
        feature: 'mini_app',
        action: 'opened',
        ...(presetId && BUILTIN_MINI_APP_TARGETS.has(presetId) && { target: presetId })
      })
    }
    webviewRuntimeService.sync(requests, capacity ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS)
  }, [tabs, activeTabId, split, setSplit, splitMiniAppId, appIds, apps, byId, capacity, closeTabs, resources])

  useIpcOn('mini_app.runtime.evicted', ({ appId }) => {
    if (split?.appId === appId) setSplit(null)
    closeTabs(tabs.filter((tab) => miniAppIdFromTabUrl(tab.url) === appId).map((tab) => tab.id))
    webviewRuntimeService.release(miniAppResourceKey(appId))
  })
  useLayoutEffect(() => () => webviewRuntimeService.dispose(), [])
}

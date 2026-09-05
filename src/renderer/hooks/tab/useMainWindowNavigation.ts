import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import i18n from '@renderer/i18n/resolver'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { OPEN_MAIN_ROUTE_EVENT, type OpenMainRouteEvent } from '@renderer/services/mainWindowNavigation'
import { isMessageOnlyConversationUrl } from '@renderer/utils/sidebar'
import { isSettingsPath, normalizeSettingsPath, type SettingsPath } from '@shared/data/types/settingsPath'
import type { MainWindowInitData } from '@shared/types/mainWindow'
import { useCallback, useEffect, useRef } from 'react'

import { useTabs } from './useTabs'

const WORKSPACE_ENTRY_ROUTES = new Set(['/app/chat', '/app/agents', '/app/translate'])

const getRoutePathname = (url: string): string => url.split(/[?#]/, 1)[0]

function useOpenSettingsRoute() {
  const { tabs, openTab, setActiveTab, updateTab } = useTabs()
  const settingsTabIdRef = useRef<string | null>(null)
  const pendingSettingsPathRef = useRef<SettingsPath | null>(null)

  useEffect(() => {
    const settingsTab = tabs.find((tab) => tab.type === 'route' && isSettingsPath(tab.url))

    if (!settingsTab) {
      settingsTabIdRef.current = null
      return
    }

    settingsTabIdRef.current = settingsTab.id

    const pendingPath = pendingSettingsPathRef.current
    if (!pendingPath) {
      return
    }

    pendingSettingsPathRef.current = null
    updateTab(settingsTab.id, {
      url: pendingPath,
      title: i18n.t('settings.title'),
      lastAccessTime: Date.now()
    })
    setActiveTab(settingsTab.id)
  }, [tabs, setActiveTab, updateTab])

  return useCallback(
    (path: SettingsPath) => {
      const targetPath = normalizeSettingsPath(path)
      const title = i18n.t('settings.title')
      const settingsTab = tabs.find((tab) => tab.type === 'route' && isSettingsPath(tab.url))

      if (settingsTab) {
        updateTab(settingsTab.id, {
          url: targetPath,
          title,
          lastAccessTime: Date.now()
        })
        setActiveTab(settingsTab.id)
        return
      }

      if (settingsTabIdRef.current) {
        pendingSettingsPathRef.current = targetPath
        return
      }

      const settingsTabId = openTab(targetPath, { title })
      settingsTabIdRef.current = settingsTabId
    },
    [tabs, openTab, setActiveTab, updateTab]
  )
}

function useMainRouteEventBridge(handleRoute: (path: string) => void) {
  useEffect(() => {
    const handleOpenMainRoute = (event: Event) => {
      event.preventDefault()
      handleRoute((event as OpenMainRouteEvent).detail.path)
    }

    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, handleOpenMainRoute)
    return () => {
      window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, handleOpenMainRoute)
    }
  }, [handleRoute])
}

/**
 * Single consumption point for main-window init data + navigation events, mounted once in
 * MainWindowRuntime. Delivery legs:
 *
 * - `OPEN_MAIN_ROUTE_EVENT` DOM event — the in-window fast path used by
 *   `openRoute()` callers living in this window (preventDefault = handled ACK).
 * - `navigation.open_route_requested` IpcApi event — the running-window path
 *   for main-process/cross-window callers; ephemeral command, no request-id
 *   bookkeeping needed.
 * - Navigation init data — the cold-start path only (the window was created FOR
 *   this route); `requestId` dedupes replays of the same stored payload.
 * - `tab-attach` init data — the cold-start path for a detached tab being
 *   re-attached (openTabInMainWindow rebuilt the window around it); same
 *   request-id dedupe, delivered to `attachTab`.
 *
 * Settings paths land in the singleton settings tab. Bare Chat, Work, and
 * Translation entries reuse the most recently visited tab in that workspace;
 * specific routes and all other paths go through `openTab`'s exact-URL dedupe.
 */
export function useMainWindowNavigation() {
  const openSettingsRoute = useOpenSettingsRoute()
  const { attachTab, openTab, setActiveTab, tabs } = useTabs()
  const initData = useWindowInitData<MainWindowInitData>()
  const handledNavigationRequestIdRef = useRef<number | null>(null)

  const handleRoute = useCallback(
    (to: string) => {
      if (isSettingsPath(to)) {
        openSettingsRoute(to)
        return
      }

      if (WORKSPACE_ENTRY_ROUTES.has(to)) {
        const existingWorkspaceTab = tabs
          .filter(
            (tab) => tab.type === 'route' && getRoutePathname(tab.url) === to && !isMessageOnlyConversationUrl(tab.url)
          )
          .reduce<(typeof tabs)[number] | undefined>(
            (latest, tab) => (!latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest),
            undefined
          )

        if (existingWorkspaceTab) {
          setActiveTab(existingWorkspaceTab.id)
          return
        }
      }

      openTab(to)
    },
    [openSettingsRoute, openTab, setActiveTab, tabs]
  )

  useIpcOn('navigation.open_route_requested', ({ to }) => handleRoute(to))

  useEffect(() => {
    if (initData?.kind !== 'navigation') return
    if (handledNavigationRequestIdRef.current === initData.requestId) return

    handledNavigationRequestIdRef.current = initData.requestId
    handleRoute(initData.to)
    void ipcApi.request('navigation.ack_open_route', { requestId: initData.requestId })
  }, [initData, handleRoute])

  // Cold-start tab re-attach: the window was rebuilt around a detached tab. Same
  // ack/dedupe discipline as navigation init data — the payload must not replay on reload.
  useEffect(() => {
    if (initData?.kind !== 'tab-attach') return
    if (handledNavigationRequestIdRef.current === initData.requestId) return

    handledNavigationRequestIdRef.current = initData.requestId
    attachTab(initData.tab)
    void ipcApi.request('navigation.ack_open_route', { requestId: initData.requestId })
  }, [initData, attachTab])

  useMainRouteEventBridge(handleRoute)

  useEffect(() => {
    void ipcApi.request('navigation.protocol_dispatch_ready')
  }, [])
}

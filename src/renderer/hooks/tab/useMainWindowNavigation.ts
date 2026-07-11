import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import i18n from '@renderer/i18n/resolver'
import { useIpcOn } from '@renderer/ipc'
import { OPEN_MAIN_ROUTE_EVENT, type OpenMainRouteEvent } from '@renderer/services/mainWindowNavigation'
import { isSettingsPath, normalizeSettingsPath, type SettingsPath } from '@shared/data/types/settingsPath'
import type { MainWindowInitData } from '@shared/types/mainWindow'
import { useCallback, useEffect, useRef } from 'react'

import { useTabs } from './useTabs'

function isSettingsTabUrl(url: string) {
  return url === '/settings' || url.startsWith('/settings/') || url.startsWith('/settings?')
}

function useOpenSettingsRoute() {
  const { tabs, openTab, setActiveTab, updateTab } = useTabs()
  const settingsTabIdRef = useRef<string | null>(null)
  const pendingSettingsPathRef = useRef<SettingsPath | null>(null)

  useEffect(() => {
    const settingsTab = tabs.find((tab) => tab.type === 'route' && isSettingsTabUrl(tab.url))

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
      const settingsTab = tabs.find((tab) => tab.type === 'route' && isSettingsTabUrl(tab.url))

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
 * Single consumption point for main-window navigation, mounted once in AppShell.
 * Three delivery legs feed the same routing split:
 *
 * - `OPEN_MAIN_ROUTE_EVENT` DOM event — the in-window fast path used by
 *   `openRoute()` callers living in this window (preventDefault = handled ACK).
 * - `navigation.open_route_requested` IpcApi event — the running-window path
 *   for main-process/cross-window callers; ephemeral command, no request-id
 *   bookkeeping needed.
 * - Navigation init data — the cold-start path only (the window was created FOR
 *   this route); `requestId` dedupes replays of the same stored payload.
 *
 * Settings paths land in the singleton settings tab; everything else goes
 * through `openTab`'s exact-URL dedupe.
 */
export function useMainWindowNavigation() {
  const openSettingsRoute = useOpenSettingsRoute()
  const { openTab } = useTabs()
  const initData = useWindowInitData<MainWindowInitData>()
  const handledNavigationRequestIdRef = useRef<number | null>(null)

  const handleRoute = useCallback(
    (to: string) => {
      if (isSettingsPath(to)) {
        openSettingsRoute(to)
      } else {
        openTab(to)
      }
    },
    [openSettingsRoute, openTab]
  )

  useIpcOn('navigation.open_route_requested', ({ to }) => handleRoute(to))

  useEffect(() => {
    if (initData?.kind !== 'navigation') return
    if (handledNavigationRequestIdRef.current === initData.requestId) return

    handledNavigationRequestIdRef.current = initData.requestId
    handleRoute(initData.to)
  }, [initData, handleRoute])

  useMainRouteEventBridge(handleRoute)
}

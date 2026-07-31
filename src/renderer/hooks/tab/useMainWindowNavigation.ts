import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { OPEN_MAIN_ROUTE_EVENT, type OpenMainRouteEvent } from '@renderer/services/mainWindowNavigation'
import { isSettingsPath, normalizeSettingsPath, type SettingsPath } from '@shared/data/types/settingsPath'
import type { MainWindowInitData } from '@shared/types/mainWindow'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useTabs } from './useTabs'

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
 * Single consumption point for main-window navigation, mounted once in MainWindowRuntime.
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
 * Settings paths open the application-level immersive Settings surface;
 * everything else goes through `openTab`'s exact-URL dedupe.
 */
export function useMainWindowNavigation() {
  const { openTab } = useTabs()
  const initData = useWindowInitData<MainWindowInitData>()
  const handledNavigationRequestIdRef = useRef<number | null>(null)
  const [settingsPath, setSettingsPathState] = useState<SettingsPath | null>(null)

  const setSettingsPath = useCallback((path: string) => {
    setSettingsPathState(normalizeSettingsPath(path))
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsPathState(null)
  }, [])

  const handleRoute = useCallback(
    (to: string) => {
      if (isSettingsPath(to)) {
        setSettingsPath(to)
      } else {
        closeSettings()
        openTab(to)
      }
    },
    [closeSettings, openTab, setSettingsPath]
  )

  useIpcOn('navigation.open_route_requested', ({ to }) => handleRoute(to))

  useEffect(() => {
    if (initData?.kind !== 'navigation') return
    if (handledNavigationRequestIdRef.current === initData.requestId) return

    handledNavigationRequestIdRef.current = initData.requestId
    handleRoute(initData.to)
    void ipcApi.request('navigation.ack_open_route', { requestId: initData.requestId })
  }, [initData, handleRoute])

  useMainRouteEventBridge(handleRoute)

  useEffect(() => {
    void ipcApi.request('navigation.protocol_dispatch_ready')
  }, [])

  return { settingsPath, setSettingsPath, closeSettings }
}

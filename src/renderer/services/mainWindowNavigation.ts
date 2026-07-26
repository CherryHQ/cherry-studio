import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { DEFAULT_SETTINGS_PATH, normalizeSettingsPath, type SettingsPath } from '@shared/data/types/settingsPath'

const logger = loggerService.withContext('mainWindowNavigation')

export const OPEN_MAIN_ROUTE_EVENT = 'cherry:open-main-route'

export type OpenMainRouteEvent = CustomEvent<{ path: string }>

/**
 * Open a route in the main window, from ANY window. Local-first delivery:
 * a cancelable DOM event is dispatched in this window — if the main-window
 * shell is here it handles the route synchronously (preventDefault = ACK,
 * zero IPC); otherwise the request falls back to the `open_route_in_main`
 * IPC, which lands it in the main window via the main process.
 */
export function openRoute(path: string): void {
  const event = new CustomEvent<{ path: string }>(OPEN_MAIN_ROUTE_EVENT, {
    cancelable: true,
    detail: { path }
  })

  window.dispatchEvent(event)
  if (!event.defaultPrevented) {
    void ipcApi.request('navigation.open_route_in_main', { path }).catch((error) => {
      logger.error('Failed to request main-window navigation', error as Error)
    })
  }
}

export function openSettingsTab(path: SettingsPath = DEFAULT_SETTINGS_PATH): void {
  openRoute(normalizeSettingsPath(path))
}

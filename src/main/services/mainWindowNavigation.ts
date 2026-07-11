import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import type { MainWindowInitData } from '@shared/types/mainWindow'

/**
 * Route allowlist for externally-triggered main-window navigation (protocol
 * deep links and the `navigation.open_route_in_main` IPC). Single source of
 * truth — do not fork a second list at a call site.
 */
export const ALLOWED_ROUTE_PREFIXES = [
  '/settings',
  '/agents',
  '/knowledge',
  '/paintings',
  '/translate',
  '/files',
  '/notes',
  '/apps',
  '/code',
  '/launchpad'
]

export const isAllowedRoute = (path: string): boolean =>
  ALLOWED_ROUTE_PREFIXES.some((route) => path === route || path.startsWith(`${route}/`))

let nextNavigationRequestId = 0

/**
 * Open a route in the main window. Two delivery paths, split by whether the
 * navigation coincides with the window's lifecycle:
 *
 * - Window alive → the navigation is a one-shot COMMAND: deliver it as the
 *   directed `navigation.open_route_requested` IpcApi event (ephemeral, no
 *   store write, no replay on reload), then raise the window.
 * - Window missing/destroyed → the window is being created FOR this route, so
 *   the route is genuine init data; `showMainWindow(initData)` stores it before
 *   creation and the renderer picks it up on cold start.
 *
 * Do NOT push navigation through init data on a live window: init data is
 * lifecycle state, persists in the store, and replays on renderer reload.
 */
export function openRouteInMainWindow(path: string): void {
  const windowManager = application.get('WindowManager')
  const mainWindowService = application.get('MainWindowService')

  const mainWindow = windowManager.getWindowsByType(WindowType.Main)[0]
  const mainWindowId = mainWindow && !mainWindow.isDestroyed() ? windowManager.getWindowId(mainWindow) : undefined

  if (mainWindowId) {
    application.get('IpcApiService').send(mainWindowId, 'navigation.open_route_requested', { to: path })
    mainWindowService.showMainWindow()
    return
  }

  mainWindowService.showMainWindow({
    kind: 'navigation',
    to: path,
    requestId: nextNavigationRequestId++
  } satisfies MainWindowInitData)
}

export function openSettingsInMainWindow(path?: SettingsPath): void {
  openRouteInMainWindow(normalizeSettingsPath(path))
}

import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
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

/** Id of the live (non-destroyed) main window, or undefined when it is missing/destroyed. */
function resolveLiveMainWindowId(): string | undefined {
  const windowManager = application.get('WindowManager')
  const mainWindow = windowManager.getWindowsByType(WindowType.Main)[0]
  return mainWindow && !mainWindow.isDestroyed() ? windowManager.getWindowId(mainWindow) : undefined
}

/**
 * Clear the stored init data for a cold-start payload after the renderer consumed it, so a
 * hot reload does not replay it. Fed by the `navigation.ack_open_route` ack — the channel
 * name predates the `tab-attach` kind, but it acks any `MainWindowInitData` by requestId.
 */
export function acknowledgeMainWindowNavigation(windowId: string, requestId: number): void {
  const windowManager = application.get('WindowManager')
  const initData = windowManager.getInitData(windowId)

  if (
    initData &&
    typeof initData === 'object' &&
    'kind' in initData &&
    (initData.kind === 'navigation' || initData.kind === 'tab-attach') &&
    'requestId' in initData &&
    initData.requestId === requestId
  ) {
    windowManager.clearInitData(windowId)
  }
}

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
  const mainWindowService = application.get('MainWindowService')

  const mainWindowId = resolveLiveMainWindowId()

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

/**
 * Re-attach a detached tab back into the main window. Mirrors
 * openRouteInMainWindow's live/cold split:
 *
 * - Window alive → deliver the tab as the directed `tab.attached` event
 *   (TabsProvider re-absorbs it), then raise the window — which also covers
 *   the close-to-tray case where the main window exists but is hidden.
 * - Window missing/destroyed → the main window is being rebuilt FOR this tab,
 *   so the tab rides along as cold-start init data (`kind: 'tab-attach'`) that
 *   the renderer attaches on boot.
 */
export function openTabInMainWindow(tab: Tab): void {
  const mainWindowService = application.get('MainWindowService')

  const mainWindowId = resolveLiveMainWindowId()

  if (mainWindowId) {
    application.get('IpcApiService').send(mainWindowId, 'tab.attached', tab)
    mainWindowService.showMainWindow()
    return
  }

  mainWindowService.showMainWindow({
    kind: 'tab-attach',
    tab,
    requestId: nextNavigationRequestId++
  } satisfies MainWindowInitData)
}

export function openSettingsInMainWindow(path?: SettingsPath): void {
  openRouteInMainWindow(normalizeSettingsPath(path))
}

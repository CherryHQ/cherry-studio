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
 *
 * `/app` is the app's real route namespace — agents/chat/knowledge/… all live
 * under it (e.g. `/app/agents`). The bare `/agents`-style entries are the
 * legacy prefixes produced by the protocol deep-link handler and are kept so
 * those links still pass the allowlist.
 */
export const ALLOWED_ROUTE_PREFIXES = [
  '/settings',
  '/app',
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

export const isAllowedRoute = (path: string): boolean => {
  // Match on the pathname only: routes may carry search params (e.g. the
  // feedback agent route `/app/agents?intent=feedback&sessionId=…`).
  const pathname = path.split('?')[0].split('#')[0]
  return ALLOWED_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

let nextNavigationRequestId = 0

/** Id of the live (non-destroyed) main window, or undefined when it is missing/destroyed. */
function resolveLiveMainWindowId(): string | undefined {
  const windowManager = application.get('WindowManager')
  const mainWindow = windowManager.getWindowsByType(WindowType.Main)[0]
  return mainWindow && !mainWindow.isDestroyed() ? windowManager.getWindowId(mainWindow) : undefined
}

/**
 * Tabs awaiting delivery to a main renderer that has not yet mounted its
 * `tab.attached` listener (cold boot, reload, or crash recovery). A directed
 * IpcApi send to a listener-less webContents is dropped silently — Electron
 * does not buffer it — so tabs are queued here and flushed once the renderer
 * reports ready via `navigation.protocol_dispatch_ready`.
 */
const pendingTabAttachQueue: Tab[] = []
let isMainRendererReadyForTabAttach = false

/**
 * Mark the main renderer ready and deliver any tabs queued while it was not.
 * Called from the `navigation.protocol_dispatch_ready` handler, alongside
 * ProtocolService.onMainRendererReady. The renderer only sends that IPC after
 * its mount effects flush, so `useIpcOn('tab.attached')` is registered by the
 * time this delivers — keep the ready signal in a mount-time effect.
 */
export function markMainRendererReadyForTabAttach(senderId: string): void {
  if (application.get('WindowManager').getWindowType(senderId) !== WindowType.Main) return
  isMainRendererReadyForTabAttach = true
  flushPendingTabAttaches()
}

/**
 * Invalidate renderer readiness (window destroyed, webContents reloading, or
 * renderer crashed). Queued tabs are kept — they flush into the next ready
 * renderer, with the target window resolved at flush time, not enqueue time.
 */
export function resetMainRendererTabAttachDelivery(): void {
  isMainRendererReadyForTabAttach = false
}

function flushPendingTabAttaches(): void {
  if (!isMainRendererReadyForTabAttach || pendingTabAttachQueue.length === 0) return
  const mainWindowId = resolveLiveMainWindowId()
  if (!mainWindowId) return
  // splice clears in place, so a duplicate ready signal cannot replay the queue.
  const queued = pendingTabAttachQueue.splice(0)
  for (const tab of queued) {
    application.get('IpcApiService').send(mainWindowId, 'tab.attached', tab)
  }
}

/**
 * A live window id only proves the BrowserWindow exists — the renderer may still
 * be booting, reloading, or crashed, with no `tab.attached` listener mounted.
 * The ready flag plus a synchronous webContents check covers the reload() →
 * did-start-loading gap that event-driven resets cannot see.
 */
function isTabDeliveryReady(windowId: string): boolean {
  if (!isMainRendererReadyForTabAttach) return false
  const win = application.get('WindowManager').getWindow(windowId)
  if (!win || win.isDestroyed()) return false
  if (win.webContents.isLoadingMainFrame() || win.webContents.isCrashed()) {
    isMainRendererReadyForTabAttach = false
    return false
  }
  return true
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
 *   store write, no replay on reload), then raise the window. Unlike tab
 *   attach this does not gate on renderer readiness: a dropped navigation is
 *   re-triggerable and harmless, while a dropped tab attach is not (the
 *   source sub-window closes).
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
    if (isTabDeliveryReady(mainWindowId)) {
      application.get('IpcApiService').send(mainWindowId, 'tab.attached', tab)
    } else if (!pendingTabAttachQueue.some((queued) => queued.id === tab.id)) {
      // Renderer not ready (fresh boot/reload/crash): queue the tab instead of
      // dropping the event; flush happens when it reports ready.
      pendingTabAttachQueue.push(tab)
    }
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

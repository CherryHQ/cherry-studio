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

/** Id of the live (non-destroyed) main window, or undefined when it is missing/destroyed. */
function resolveLiveMainWindowId(): string | undefined {
  const windowManager = application.get('WindowManager')
  const mainWindow = windowManager.getWindowsByType(WindowType.Main)[0]
  return mainWindow && !mainWindow.isDestroyed() ? windowManager.getWindowId(mainWindow) : undefined
}

type PendingMainWindowDelivery = { kind: 'route'; path: string } | { kind: 'tab-attach'; tab: Tab }

/**
 * Commands awaiting a main renderer that has not mounted its listeners yet
 * (cold boot, reload, or crash recovery). Electron does not buffer directed
 * sends, so preserve their real order and flush after
 * `navigation.protocol_dispatch_ready`. Only adjacent exact route duplicates
 * are coalesced; repeating a route after another command is a distinct user
 * intent and must retain its place in the sequence.
 */
/** Owns queued deliveries and readiness across individual main-window rebuilds. */
class MainWindowNavigationService {
  nextNavigationRequestId = 0
  pendingMainWindowDeliveries: PendingMainWindowDelivery[] = []
  isMainRendererReadyForDelivery = false
}

const mainWindowNavigationService = new MainWindowNavigationService()

function enqueueRouteNavigation(path: string): void {
  const { pendingMainWindowDeliveries } = mainWindowNavigationService
  const previous = pendingMainWindowDeliveries.at(-1)
  if (previous?.kind === 'route' && previous.path === path) return
  pendingMainWindowDeliveries.push({ kind: 'route', path })
}

function enqueueTabAttach(tab: Tab): void {
  const { pendingMainWindowDeliveries } = mainWindowNavigationService
  const existingIndex = pendingMainWindowDeliveries.findIndex(
    (delivery) => delivery.kind === 'tab-attach' && delivery.tab.id === tab.id
  )
  if (existingIndex >= 0) {
    // Refresh the payload without moving its original request position across other delivery kinds.
    pendingMainWindowDeliveries[existingIndex] = { kind: 'tab-attach', tab }
    return
  }
  pendingMainWindowDeliveries.push({ kind: 'tab-attach', tab })
}

/**
 * Mark the main renderer ready and deliver any routes or tabs queued while it was not.
 * Called from the `navigation.protocol_dispatch_ready` handler, alongside
 * ProtocolService.onMainRendererReady. The renderer only sends that IPC after
 * its mount effects flush, so navigation and `tab.attached` listeners are
 * registered by the time this delivers — keep the ready signal in a mount-time effect.
 */
export function markMainRendererReadyForDelivery(senderId: string): void {
  if (application.get('WindowManager').getWindowType(senderId) !== WindowType.Main) return
  mainWindowNavigationService.isMainRendererReadyForDelivery = true
  flushPendingMainWindowDeliveries()
}

/**
 * Invalidate renderer readiness (window destroyed, webContents reloading, or
 * renderer crashed). Queued routes and tabs are kept — they flush into the
 * next ready renderer, with the target window resolved at flush time, not enqueue time.
 */
export function resetMainRendererDelivery(): void {
  mainWindowNavigationService.isMainRendererReadyForDelivery = false
}

/** Clear readiness and discard commands when the owning service is stopped or destroyed. */
export function clearMainWindowDeliveryState(): void {
  resetMainRendererDelivery()
  mainWindowNavigationService.pendingMainWindowDeliveries.splice(0)
}

function flushPendingMainWindowDeliveries(): void {
  const { pendingMainWindowDeliveries } = mainWindowNavigationService
  if (!mainWindowNavigationService.isMainRendererReadyForDelivery || pendingMainWindowDeliveries.length === 0) return
  const mainWindowId = resolveLiveMainWindowId()
  if (!mainWindowId) return
  const queued = pendingMainWindowDeliveries.splice(0)
  for (const delivery of queued) {
    if (delivery.kind === 'route') {
      application.get('IpcApiService').send(mainWindowId, 'navigation.open_route_requested', {
        to: delivery.path
      })
    } else {
      application.get('IpcApiService').send(mainWindowId, 'tab.attached', delivery.tab)
    }
  }
}

/**
 * A live window id only proves the BrowserWindow exists — the renderer may still
 * be booting, reloading, or crashed, with no navigation listeners mounted.
 * The ready flag plus a synchronous webContents check covers the reload() →
 * did-start-loading gap that event-driven resets cannot see.
 */
function isMainRendererDeliveryReady(windowId: string): boolean {
  if (!mainWindowNavigationService.isMainRendererReadyForDelivery) return false
  const win = application.get('WindowManager').getWindow(windowId)
  if (!win || win.isDestroyed()) return false
  if (win.webContents.isLoadingMainFrame() || win.webContents.isCrashed()) {
    mainWindowNavigationService.isMainRendererReadyForDelivery = false
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
 *   store write, no replay on reload), then raise the window. If the renderer
 *   is still booting or reloading, queue each distinct requested route and
 *   deliver them in request order after `navigation.protocol_dispatch_ready`.
 * - Window missing/destroyed → when this route starts a fresh rebuild, it is
 *   genuine init data and the renderer picks it up on cold start. If another
 *   delivery already started the rebuild, append this route to the unified
 *   queue instead so route/tab ordering is preserved when the renderer becomes
 *   ready.
 *
 * Do NOT push navigation through init data on a live window: init data is
 * lifecycle state, persists in the store, and replays on renderer reload.
 */
export function openRouteInMainWindow(path: string): void {
  const mainWindowService = application.get('MainWindowService')

  const mainWindowId = resolveLiveMainWindowId()

  if (mainWindowId) {
    if (isMainRendererDeliveryReady(mainWindowId)) {
      application.get('IpcApiService').send(mainWindowId, 'navigation.open_route_requested', { to: path })
    } else {
      enqueueRouteNavigation(path)
    }
    mainWindowService.showMainWindow()
    return
  }

  if (mainWindowNavigationService.pendingMainWindowDeliveries.length > 0) {
    enqueueRouteNavigation(path)
    mainWindowService.showMainWindow()
    return
  }

  mainWindowService.showMainWindow({
    kind: 'navigation',
    to: path,
    requestId: mainWindowNavigationService.nextNavigationRequestId++
  } satisfies MainWindowInitData)
}

/**
 * Re-attach a detached tab back into the main window. Mirrors
 * openRouteInMainWindow's live/cold split:
 *
 * - Window alive → deliver the tab as the directed `tab.attached` event
 *   (TabsProvider re-absorbs it), then raise the window — which also covers
 *   the close-to-tray case where the main window exists but is hidden.
 * - Window missing/destroyed → when this tab starts a fresh rebuild, it rides
 *   along as cold-start init data (`kind: 'tab-attach'`). If a rebuild is
 *   already pending, append it to the unified route/tab queue instead so the
 *   renderer observes the original request order once ready.
 */
export function openTabInMainWindow(tab: Tab): void {
  const mainWindowService = application.get('MainWindowService')

  const mainWindowId = resolveLiveMainWindowId()

  if (mainWindowId) {
    if (isMainRendererDeliveryReady(mainWindowId)) {
      application.get('IpcApiService').send(mainWindowId, 'tab.attached', tab)
    } else {
      // Renderer not ready (fresh boot/reload/crash): queue the tab instead of
      // dropping the event; flush happens when it reports ready.
      enqueueTabAttach(tab)
    }
    mainWindowService.showMainWindow()
    return
  }

  if (mainWindowNavigationService.pendingMainWindowDeliveries.length > 0) {
    enqueueTabAttach(tab)
    mainWindowService.showMainWindow()
    return
  }

  mainWindowService.showMainWindow({
    kind: 'tab-attach',
    tab,
    requestId: mainWindowNavigationService.nextNavigationRequestId++
  } satisfies MainWindowInitData)
}

export function openSettingsInMainWindow(path?: SettingsPath): void {
  openRouteInMainWindow(normalizeSettingsPath(path))
}

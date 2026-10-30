import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'
import type { AppErrorContext } from '@shared/types/appError'
import type { MainWindowInitData } from '@shared/types/mainWindow'
import { createAppErrorContext } from '@shared/utils/appError'

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
let errorReceiverReady = false
let updateReceiverReady = false

type MainSurfaceReceiver = 'error' | 'update'

/**
 * The tab-ready flag stays set after a provider crash: the webContents is still
 * alive, but AppErrorRuntime and the update handler have unmounted. Delivery of
 * those events requires the receiver that actually mounts the listener.
 */
export function setMainSurfaceReceiver(kind: MainSurfaceReceiver, ready: boolean): void {
  if (kind === 'error') {
    errorReceiverReady = ready
    if (ready) flushMainRendererFault()
  } else {
    updateReceiverReady = ready
  }
}

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
  errorReceiverReady = false
  updateReceiverReady = false
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

let pendingRendererFault: AppErrorContext | undefined

/**
 * Remember a main-renderer crash until that renderer is ready again.
 * The second crash inside the force-exit window never queues a fault: that path
 * leaves the process, so there is no window left to present it.
 */
export function queueMainRendererFault(message: string): void {
  pendingRendererFault = createAppErrorContext({
    source: 'mainWindow',
    operation: 'renderer.crash',
    message
  })
}

function flushMainRendererFault(): void {
  if (!pendingRendererFault) return
  if (deliverToReadyMain('app.error.open', pendingRendererFault)) pendingRendererFault = undefined
}

/**
 * Show and focus a ready main window, then deliver one event to it.
 * Returns false when main is missing, still loading, or crashed — callers must
 * fail the IPC instead of broadcasting into an empty room.
 */
export function deliverToReadyMain<E extends IpcEventName>(event: E, payload: EventPayload<E>): boolean {
  const windowManager = application.get('WindowManager')
  const mainWindow = windowManager.getWindowsByType(WindowType.Main).find((win) => !win.isDestroyed())
  if (!mainWindow) return false
  const windowId = windowManager.getWindowId(mainWindow)
  if (!windowId || !isTabDeliveryReady(windowId) || !isSurfaceReceiverReady(event)) return false
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  application.get('IpcApiService').send(windowId, event, payload)
  return true
}

/**
 * A live window id only proves the BrowserWindow exists — the renderer may still
 * be booting, reloading, or crashed, with no listener mounted.
 * The ready flag plus a synchronous webContents check covers the reload gap.
 */
function isSurfaceReceiverReady(event: IpcEventName): boolean {
  if (event === 'app.error.open') return errorReceiverReady
  if (event === 'app.updater.run_check') return updateReceiverReady
  return true
}

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

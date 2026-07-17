import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { validateSender } from '@main/core/security/validateSender'
import type { WindowOptions } from '@main/core/window/types'
import { WindowType } from '@main/core/window/types'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { WindowId } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { SubWindowInitData } from '@shared/types/subWindow'
import { normalizeTabInstanceMetadata } from '@shared/utils/tabInstanceMetadata'
import { BrowserWindow, ipcMain, type IpcMainEvent, nativeImage, nativeTheme } from 'electron'

import iconPath from '../../../build/icon.png?asset'

const logger = loggerService.withContext('SubWindowService')

// Mirrors MainWindowService: Linux (especially Wayland) needs a NativeImage here —
// a raw string path silently fails to populate the task switcher / taskbar icon
// after packaging. macOS ignores the icon field (Dock reads the .app bundle);
// Windows reads the taskbar icon from the exe manifest. So we only materialize
// one on Linux and only pass it through on Linux; the field is omitted otherwise.
const linuxIcon = isLinux ? nativeImage.createFromPath(iconPath) : undefined

/** Default content-size cache for SubWindow (must match windowRegistry width/height) */
const SUB_WINDOW_DEFAULT_WIDTH = 800
const SUB_WINDOW_DEFAULT_HEIGHT = 600

/**
 * After Tab_MoveWindow, ignore `resize` bursts briefly so DPI rounding noise is not written back
 * into the content-size cache (would feed the next setContentBounds and re-trigger electron#27651).
 * Empirically chosen: covers typical DPI-rounding resize burst (~100–200ms on test machines).
 */
const MOVE_RESIZE_IGNORE_MS = 280

/** Win/Linux: move sub windows with setContentBounds + cached size (see electron#27651). */
const USE_CONTENT_BOUNDS_MOVE = isWin || isLinux

type SubWindowState = {
  /** Cached content size to avoid getBounds() round-trips during drag (electron#27651) */
  width: number
  height: number
  /** Timestamp of last Tab_MoveWindow IPC, used to debounce resize events triggered by the move */
  lastMoveAt: number
}

@Injectable('SubWindowService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class SubWindowService extends BaseService {
  /** tabId → windowId map (windowId belongs to WindowManager's namespace, distinct from tabId) */
  private tabIdToWindowId: Map<string, string> = new Map()
  private windowState: Map<string, SubWindowState> = new Map()

  protected async onInit() {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers() {
    // Tab_MoveWindow is the repo's only per-frame R→M escape hatch (see docs Not-In-Scope):
    // it stays on native IPC rather than IpcApi. Registered with native ipcMain.on + an explicit
    // validateSender gate (mirroring the data subsystems), cleaned up via registerDisposable —
    // NOT the `this.ipcOn` sugar (slated for removal). Tab_Attach / Tab_Detach / Tab_DragEnd /
    // SubWindow_SetAlwaysOnTop moved to IpcApi (tab.* / window.*).
    const onMoveWindow = (event: IpcMainEvent, payload: { tabId: string; x: number; y: number }) => {
      if (!validateSender(event)) return
      const wm = application.get('WindowManager')
      // Prefer tabId lookup: when the main window sends this IPC, event.sender is the main window,
      // but we want to move the sub window identified by tabId.
      const targetWindowId = this.tabIdToWindowId.get(payload.tabId)
      const win = (targetWindowId && wm.getWindow(targetWindowId)) || BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        const x = Math.round(payload.x)
        const y = Math.round(payload.y)
        this.moveWindow(win, payload.tabId, x, y)
        if (!win.isVisible()) {
          win.show()
        }
        // Only apply opacity when the sub window is dragging its own tab (preparing to reattach).
        // Keep object-identity compare: wm.getWindow() returns the same BrowserWindow instance
        // that BrowserWindow.fromWebContents(sender) returns for the same webContents.
        const senderWindow = BrowserWindow.fromWebContents(event.sender)
        if (senderWindow === win && win.getOpacity() !== 0.85) {
          win.setOpacity(0.85)
        }
      }
    }
    ipcMain.on(IpcChannel.Tab_MoveWindow, onMoveWindow)
    this.registerDisposable(() => ipcMain.removeListener(IpcChannel.Tab_MoveWindow, onMoveWindow))
  }

  /**
   * Moves a sub window to (x, y).
   * On Win/Linux uses setContentBounds with cached size to avoid electron#27651 outer-bounds creep.
   * On macOS uses setPosition (no reported creep issue).
   */
  private moveWindow(win: BrowserWindow, tabId: string, x: number, y: number) {
    if (USE_CONTENT_BOUNDS_MOVE) {
      const state = this.windowState.get(tabId)
      if (state) {
        state.lastMoveAt = Date.now()
      }
      const { width, height } = state ?? { width: SUB_WINDOW_DEFAULT_WIDTH, height: SUB_WINDOW_DEFAULT_HEIGHT }
      win.setContentBounds({ x, y, width, height })
    } else {
      win.setPosition(x, y)
    }
  }

  /**
   * Tracks the content size of a sub window, keeping windowState in sync for the
   * DPI-rounding debounce in moveWindow. Cleanup of windowState is handled centrally
   * by the `.once('closed')` listener in createWindow — do not attach one here too.
   */
  private trackWindowSize(tabId: string, win: BrowserWindow) {
    this.windowState.set(tabId, { width: SUB_WINDOW_DEFAULT_WIDTH, height: SUB_WINDOW_DEFAULT_HEIGHT, lastMoveAt: 0 })

    win.on('ready-to-show', () => {
      if (!win.isDestroyed()) {
        const { width, height } = win.getContentBounds()
        const state = this.windowState.get(tabId)
        if (state) {
          state.width = width
          state.height = height
        }
      }
    })

    win.on('resize', () => {
      if (win.isDestroyed()) return
      const state = this.windowState.get(tabId)
      if (!state || Date.now() - state.lastMoveAt < MOVE_RESIZE_IGNORE_MS) return
      const { width, height } = win.getContentBounds()
      state.width = width
      state.height = height
    })
  }

  public createWindow(payload: {
    id: string
    url: string
    title?: string
    icon?: string
    type?: string
    isPinned?: boolean
    metadata?: Record<string, unknown>
    x?: number
    y?: number
  }): string {
    const wm = application.get('WindowManager')
    const { id: tabId, url, title, icon, type, isPinned, metadata, x, y } = payload
    const hasPosition = x !== undefined && y !== undefined
    const dark = nativeTheme.shouldUseDarkColors
    const tabInstanceMetadata = normalizeTabInstanceMetadata(metadata)

    const initData: SubWindowInitData = {
      tabId,
      url,
      title,
      ...(icon && { icon }),
      type: type === 'route' || type === 'webview' ? type : 'route',
      isPinned,
      ...(tabInstanceMetadata && { metadata: tabInstanceMetadata })
    }

    // Dynamic options injected per-call (registry carries platform-static defaults only).
    // Deliberately omit `backgroundColor` on macOS — an undefined value can still overwrite
    // the vibrancy-enabled default through the options merge path.
    const options: Partial<WindowOptions> = {
      title: title || 'Cherry Studio Tab',
      darkTheme: dark,
      ...(!isMac && { backgroundColor: dark ? '#181818' : '#FFFFFF' }),
      ...(isLinux && { icon: linuxIcon }),
      ...(hasPosition && { x, y })
    }

    // The settings layout (sidebar + content) collapses below ~760×560, so a detached settings
    // tab needs that minimum-size floor. SubWindow is a
    // pooled type, so standby windows are constructed with the registry default minimum (400×300)
    // before the url is known — injecting minWidth/minHeight into the open() options can't change
    // an already-constructed BrowserWindow. So enforce it after handover via setMinimumSize().
    const isSettingsWindow = url.startsWith('/settings')

    const windowId = wm.open(WindowType.SubWindow, { initData, options })
    const win = wm.getWindow(windowId)
    if (!win) {
      logger.error('wm.open returned windowId but getWindow is undefined', { windowId, tabId })
      return windowId
    }

    this.tabIdToWindowId.set(tabId, windowId)

    // showMode: 'manual' — WM does not auto-show, so reveal the window here. A recycled
    // pre-warmed pool window keeps its standby geometry (centered/off-cursor), and the per-call
    // x/y options don't reposition an already-created pooled window — that normally happens via
    // the follow-up Tab_MoveWindow stream. But a quick drag-release (or any detach that produces
    // no post-detach pointermove) sends no move, leaving the torn-out window shown off-cursor or
    // never shown at all. So when we have an initial position, place the window there explicitly
    // BEFORE showing it; the move stream (if any) then keeps tracking the cursor. Safe for fresh
    // and pooled-standby windows: paintWhenInitiallyHidden (Electron default true) means the
    // renderer already painted while hidden, so show() reveals real content (no empty flash).
    if (!win.isDestroyed()) {
      if (isSettingsWindow) {
        win.setMinimumSize(760, 560)
      }
      if (hasPosition) {
        // setPosition/setContentBounds require integers — round here (HiDPI screenX/Y can be
        // fractional), mirroring the Tab_MoveWindow handler which rounds before moveWindow.
        this.moveWindow(win, tabId, Math.round(x), Math.round(y))
      }
      win.show()
    }

    if (USE_CONTENT_BOUNDS_MOVE) {
      this.trackWindowSize(tabId, win)
    }

    // Single cleanup entry point. Node's EventEmitter snapshots listeners at emit time,
    // so even if WindowManager's internal 'closed' handler later calls removeAllListeners,
    // this callback has already executed.
    win.once('closed', () => {
      this.tabIdToWindowId.delete(tabId)
      this.windowState.delete(tabId)
    })

    logger.info(`Created sub window for tab ${tabId}`, { windowId, url, title, type, isPinned })
    return windowId
  }

  /** Whether the calling window resolves to a SubWindow (guards operations that must never act on the main window). */
  private isSubWindowSender(senderId: WindowId | null): senderId is WindowId {
    return senderId != null && application.get('WindowManager').getWindowType(senderId) === WindowType.SubWindow
  }

  /**
   * Re-attaches a tab from a detached sub-window back into the main window: broadcasts the
   * Tab to the main window (which re-absorbs it) and closes the caller sub-window. The two
   * guards are load-bearing: skip the whole thing when no main window exists (else the tab
   * would be lost), and only close the caller when it truly is a SubWindow (never the main
   * window). `senderId` is the calling window resolved by IpcContext.
   */
  public attachTab(tab: Tab, senderId: WindowId | null): void {
    const wm = application.get('WindowManager')
    if (wm.getWindowsByType(WindowType.Main).length === 0) {
      logger.warn('tab attach skipped: main window not available')
      return
    }
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'tab.attached', tab)
    if (this.isSubWindowSender(senderId)) wm.close(senderId)
  }

  /**
   * Pins/unpins the caller sub-window (always-on-top). Only a SubWindow caller is honored —
   * the main window is rejected. Returns whether the pin was applied (the renderer reads this
   * to reconcile its toggle state).
   */
  public setAlwaysOnTop(senderId: WindowId | null, pinned: boolean): boolean {
    if (!this.isSubWindowSender(senderId)) return false
    application.get('WindowManager').behavior.setAlwaysOnTop(senderId, pinned)
    return true
  }
}

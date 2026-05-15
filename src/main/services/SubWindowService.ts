import { application } from '@application'
import { loggerService } from '@logger'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isLinux, isMac, isWin } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { WindowOptions } from '@main/core/window/types'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { SubWindowInitData } from '@shared/types/subWindow'
import { BrowserWindow, nativeImage, nativeTheme } from 'electron'

import iconPath from '../../../build/icon.png?asset'

const logger = loggerService.withContext('SubWindowService')

// Mirrors MainWindowService: Linux (especially Wayland) needs a NativeImage here —
// a raw string path silently fails to populate the task switcher / taskbar icon
// after packaging. macOS ignores the icon field (Dock reads the .app bundle);
// Windows reads the taskbar icon from the exe manifest. So we only materialize
// one on Linux and only pass it through on Linux; the field is omitted otherwise.
const linuxIcon = isLinux ? nativeImage.createFromPath(iconPath) : undefined

/** Height of the tab bar area used for drag-to-attach detection (must match CSS h-10) */
const TAB_BAR_HEIGHT = 40

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
    this.ipcOn(IpcChannel.Tab_Detach, (_, payload) => {
      this.createWindow(payload)
    })

    this.ipcHandle(IpcChannel.Tab_Attach, (event, payload) => {
      const wm = application.get('WindowManager')
      if (wm.getWindowsByType(WindowType.Main).length === 0) {
        logger.warn('Tab_Attach failed: main window not available')
        return false
      }

      try {
        wm.broadcastToType(WindowType.Main, IpcChannel.Tab_Attach, payload)
      } catch (err) {
        logger.error('Tab_Attach failed: could not send to main window', err as Error)
        return false
      }

      // Close the sender sub window after successful broadcast. Membership is
      // determined via WindowManager's own type index (not the service's private
      // map) so this branch does not depend on tabIdToWindowId staying in sync.
      const senderId = wm.getWindowIdByWebContents(event.sender)
      const isSubWindow = senderId ? wm.getWindowsByType(WindowType.SubWindow).some((w) => w.id === senderId) : false
      if (senderId && isSubWindow) {
        try {
          wm.close(senderId)
        } catch (err) {
          logger.error('Failed to close sub window after tab attach', err as Error)
        }
      }
      return true
    })

    this.ipcOn(IpcChannel.Tab_MoveWindow, (event, payload: { tabId: string; x: number; y: number }) => {
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
    })

    this.ipcHandle(
      IpcChannel.Tab_TryAttach,
      (_, payload: { tab: { id: string }; screenX: number; screenY: number }) => {
        const wm = application.get('WindowManager')
        const mainInfo = wm.getWindowsByType(WindowType.Main)[0]
        const mainWindow = mainInfo ? wm.getWindow(mainInfo.id) : undefined
        if (!mainWindow || mainWindow.isDestroyed()) {
          logger.warn('Tab_TryAttach failed: main window not available')
          return false
        }

        const bounds = mainWindow.getBounds()
        const isOverTabBar =
          payload.screenX >= bounds.x &&
          payload.screenX <= bounds.x + bounds.width &&
          payload.screenY >= bounds.y &&
          payload.screenY <= bounds.y + TAB_BAR_HEIGHT

        if (isOverTabBar) {
          try {
            wm.broadcastToType(WindowType.Main, IpcChannel.Tab_Attach, payload.tab)
          } catch (err) {
            logger.error('Tab_TryAttach failed: could not send to main window', err as Error)
            return false
          }

          const subWindowId = this.tabIdToWindowId.get(payload.tab.id)
          if (subWindowId) {
            wm.close(subWindowId)
          }
          return true
        }

        // Not over tab bar — restore opacity
        const subWindowId = this.tabIdToWindowId.get(payload.tab.id)
        const subWin = subWindowId ? wm.getWindow(subWindowId) : undefined
        if (subWin && !subWin.isDestroyed()) {
          subWin.setOpacity(1)
        }

        return false
      }
    )

    this.ipcOn(IpcChannel.Tab_DragEnd, (event) => {
      // Restore opacity for the sender window after drag ends. Main window never sets
      // opacity <1, so the opacity predicate self-gates — no additional SubWindow filter needed.
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (senderWindow && !senderWindow.isDestroyed() && senderWindow.getOpacity() < 1) {
        senderWindow.setOpacity(1)
      }
    })
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
    type?: string
    isPinned?: boolean
    x?: number
    y?: number
  }): string {
    const wm = application.get('WindowManager')
    const { id: tabId, url, title, type, isPinned, x, y } = payload
    const hasPosition = x !== undefined && y !== undefined
    const dark = nativeTheme.shouldUseDarkColors

    const initData: SubWindowInitData = {
      tabId,
      url,
      title,
      type: type === 'route' || type === 'webview' ? type : 'route',
      isPinned
    }

    // Dynamic options injected per-call (registry carries platform-static defaults only).
    // Deliberately omit `backgroundColor` on macOS — an undefined value can still overwrite
    // the vibrancy-enabled default through the options merge path.
    const options: Partial<WindowOptions> = {
      title: title || 'Cherry Studio Tab',
      darkTheme: dark,
      ...(isMac && { titleBarOverlay: dark ? titleBarOverlayDark : titleBarOverlayLight }),
      ...(!isMac && { backgroundColor: dark ? '#181818' : '#FFFFFF' }),
      ...(isLinux && { icon: linuxIcon }),
      ...(hasPosition && { x, y })
    }

    const windowId = wm.open(WindowType.SubWindow, { initData, options })
    const win = wm.getWindow(windowId)
    if (!win) {
      logger.error('wm.open returned windowId but getWindow is undefined', { windowId, tabId })
      return windowId
    }

    this.tabIdToWindowId.set(tabId, windowId)

    // showMode: 'manual' — WM does not auto-show. Callers that supply an initial position
    // will receive Tab_MoveWindow which shows the window after repositioning; otherwise
    // auto-show once Electron signals ready.
    if (!hasPosition) {
      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.show()
      })
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
}

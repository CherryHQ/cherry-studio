import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux, isMac, isWin } from '@main/core/platform'
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
  /** windowId → cached content size (per physical window; survives pool reuse) */
  private windowState: Map<string, SubWindowState> = new Map()
  /** windowIds that have fired ready-to-show at least once (cleared on destroy) */
  private readyWindows: Set<string> = new Set()

  protected async onInit() {
    // Attach per-physical-window listeners here, not in createWindow: onWindowCreatedByType
    // fires exactly once per BrowserWindow and NOT on pool reuse, so listeners never
    // accumulate across the lazy-pooled window's many reuses.
    const wm = application.get('WindowManager')
    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.SubWindow, (managed) => {
        this.attachPerWindowListeners(managed.id, managed.window)
      })
    )
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
        const windowId = targetWindowId ?? wm.getWindowIdByWebContents(event.sender)
        this.moveWindow(win, windowId, x, y)
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
  private moveWindow(win: BrowserWindow, windowId: string | undefined, x: number, y: number) {
    if (USE_CONTENT_BOUNDS_MOVE) {
      const state = windowId ? this.windowState.get(windowId) : undefined
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
   * Attach listeners that must live for the lifetime of one physical BrowserWindow.
   * Registered via onWindowCreatedByType, which fires exactly once per window and NOT on
   * pool reuse — so these never accumulate across the lazy-pooled window's many reuses.
   */
  private attachPerWindowListeners(windowId: string, win: BrowserWindow) {
    // Win/Linux only: cache content size for the setContentBounds move path (electron#27651).
    if (USE_CONTENT_BOUNDS_MOVE) {
      this.windowState.set(windowId, {
        width: SUB_WINDOW_DEFAULT_WIDTH,
        height: SUB_WINDOW_DEFAULT_HEIGHT,
        lastMoveAt: 0
      })

      win.on('resize', () => {
        if (win.isDestroyed()) return
        const state = this.windowState.get(windowId)
        if (!state || Date.now() - state.lastMoveAt < MOVE_RESIZE_IGNORE_MS) return
        const { width, height } = win.getContentBounds()
        state.width = width
        state.height = height
      })
    }

    // ready-to-show fires once per physical window (not on reuse). Record readiness so a
    // no-position reused window can be shown immediately, and capture the initial size.
    win.once('ready-to-show', () => {
      this.readyWindows.add(windowId)
      if (win.isDestroyed()) return
      const state = this.windowState.get(windowId)
      if (state) {
        const { width, height } = win.getContentBounds()
        state.width = width
        state.height = height
      }
    })

    // Pool reuse hides the window; only an actual destroy fires 'closed'. Clean up all
    // per-window tracking here. Node snapshots listeners at emit time, so this still runs
    // even though WindowManager removes its own listeners during teardown.
    win.once('closed', () => {
      this.readyWindows.delete(windowId)
      this.windowState.delete(windowId)
      for (const [tabId, mappedId] of this.tabIdToWindowId) {
        if (mappedId === windowId) this.tabIdToWindowId.delete(tabId)
      }
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

    // Pooled reuse: a recycled window may still carry the previous session's tabId mapping
    // (recycle hides without firing 'closed'). Drop any stale entry pointing at this
    // physical window before registering the new tab.
    for (const [existingTabId, mappedId] of this.tabIdToWindowId) {
      if (mappedId === windowId) this.tabIdToWindowId.delete(existingTabId)
    }
    this.tabIdToWindowId.set(tabId, windowId)

    // resetPooledWindowGeometry restores geometry only — title/backgroundColor/opacity are
    // NOT re-applied on reuse. Set them per-open so a reused window matches the current tab's
    // title and theme instead of the previous consumer's. Opacity reset matters because a
    // successful drag-back reattach closes (now recycles) the window while it is still at
    // the 0.85 drag opacity, which would otherwise persist into the next reuse.
    win.setTitle(title || 'Cherry Studio Tab')
    win.setOpacity(1)
    if (!isMac) {
      win.setBackgroundColor(dark ? '#181818' : '#FFFFFF')
    }

    // showMode: 'manual' — WM does not auto-show.
    // - has position (drop-at-cursor detach): Tab_MoveWindow shows it after repositioning.
    // - no position (programmatic detach): show once ready. A reused window already fired
    //   ready-to-show (it won't fire again), so show now; a fresh window waits for it.
    if (!hasPosition) {
      if (this.readyWindows.has(windowId)) {
        if (!win.isDestroyed()) win.show()
      } else {
        win.once('ready-to-show', () => {
          if (!win.isDestroyed()) win.show()
        })
      }
    }

    logger.info(`Created sub window for tab ${tabId}`, { windowId, url, title, type, isPinned })
    return windowId
  }
}

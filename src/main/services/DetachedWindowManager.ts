import { application } from '@application'
import { is } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isLinux, isMac, isWin } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'

import icon from '../../../build/icon.png?asset'

const logger = loggerService.withContext('DetachedWindowManager')

/** Height of the tab bar area used for drag-to-attach detection (must match CSS h-10) */
const TAB_BAR_HEIGHT = 40

/** Must match createWindow BrowserWindow width/height */
const DETACHED_DEFAULT_WIDTH = 800
const DETACHED_DEFAULT_HEIGHT = 600

/**
 * After Tab_MoveWindow, ignore `resize` bursts briefly so DPI rounding noise is not written back
 * into the content-size cache (would feed the next setContentBounds and re-trigger electron#27651).
 * empirically chosen: covers typical DPI-rounding resize burst (~100–200ms on test machines)
 */
const MOVE_RESIZE_IGNORE_MS = 280

/** Win/Linux: move detached windows with setContentBounds + cached size (see electron#27651). */
const USE_CONTENT_BOUNDS_MOVE = isWin || isLinux

type DetachedWindowState = {
  /** Cached content size to avoid getBounds() round-trips during drag (electron#27651) */
  width: number
  height: number
  /** Timestamp of last Tab_MoveWindow IPC, used to debounce resize events triggered by the move */
  lastMoveAt: number
}

@Injectable('DetachedWindowManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class DetachedWindowManager extends BaseService {
  private windows: Map<string, BrowserWindow> = new Map()
  private windowState: Map<string, DetachedWindowState> = new Map()
  private windowUrls: Map<string, string> = new Map()

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
      } catch (err: any) {
        logger.error('Tab_Attach failed: could not send to main window', err as Error)
        return false
      }

      // Close sender detached window after successful broadcast. Main-window
      // senders are skipped because they are not in the DetachedWindowManager
      // pool (this.windows) and the check below only fires for detached tabs.
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      const isDetachedTab = senderWindow ? Array.from(this.windows.values()).includes(senderWindow) : false
      if (senderWindow && isDetachedTab && !senderWindow.isDestroyed()) {
        try {
          senderWindow.close()
        } catch (err: any) {
          logger.error('Failed to close detached window after tab attach', err as Error)
        }
      }
      return true
    })

    this.ipcOn(IpcChannel.Tab_MoveWindow, (event, payload: { tabId: string; x: number; y: number }) => {
      // Prefer tabId lookup: when the main window sends this IPC, event.sender is the main window,
      // but we want to move the detached window identified by tabId.
      const win = this.windows.get(payload.tabId) ?? BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        const x = Math.round(payload.x)
        const y = Math.round(payload.y)
        this.moveWindow(win, payload.tabId, x, y)
        if (!win.isVisible()) {
          win.show()
        }
        // Only apply opacity when the detached window is dragging its own tab (preparing to reattach).
        // When the main window sends Tab_MoveWindow, event.sender differs from the detached window.
        const senderWindow = BrowserWindow.fromWebContents(event.sender)
        if (senderWindow === win && win.getOpacity() !== 0.85) {
          win.setOpacity(0.85)
        }
      }
    })

    this.ipcHandle(
      IpcChannel.Tab_TryAttach,
      (_, payload: { tab: { id: string }; screenX: number; screenY: number }) => {
        // Main window is a singleton. Resolve the BrowserWindow directly via
        // WindowManager (we need .getBounds() for geometry check — broadcast
        // alone isn't enough).
        const wm = application.get('WindowManager')
        const mainWindow = wm.getAllWindows().find((m) => m.type === WindowType.Main)?.window
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
          } catch (err: any) {
            logger.error('Tab_TryAttach failed: could not send to main window', err as Error)
            return false
          }

          const detachedWin = this.windows.get(payload.tab.id)
          if (detachedWin && !detachedWin.isDestroyed()) {
            detachedWin.close()
          }
          return true
        }

        // Not over tab bar — restore opacity
        const detachedWin = this.windows.get(payload.tab.id)
        if (detachedWin && !detachedWin.isDestroyed()) {
          detachedWin.setOpacity(1)
        }

        return false
      }
    )

    this.ipcOn(IpcChannel.Tab_DragEnd, (event) => {
      // Restore opacity for the sender window after drag ends
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (senderWindow && !senderWindow.isDestroyed() && senderWindow.getOpacity() < 1) {
        senderWindow.setOpacity(1)
      }
    })
  }

  /**
   * Moves a detached window to (x, y).
   * On Win/Linux uses setContentBounds with cached size to avoid electron#27651 outer-bounds creep.
   * On macOS uses setPosition (no reported creep issue).
   */
  private moveWindow(win: BrowserWindow, tabId: string, x: number, y: number) {
    if (USE_CONTENT_BOUNDS_MOVE) {
      const state = this.windowState.get(tabId)
      if (state) {
        state.lastMoveAt = Date.now()
      }
      const { width, height } = state ?? { width: DETACHED_DEFAULT_WIDTH, height: DETACHED_DEFAULT_HEIGHT }
      // electron#27651: avoid outer getBounds/setBounds round-trips during drag
      win.setContentBounds({ x, y, width, height })
    } else {
      win.setPosition(x, y)
    }
  }

  /**
   * Tracks the content size of a detached window, keeping windowState in sync.
   * Must be called once per created window; cleans up state on close.
   */
  private trackWindowSize(tabId: string, win: BrowserWindow) {
    this.windowState.set(tabId, { width: DETACHED_DEFAULT_WIDTH, height: DETACHED_DEFAULT_HEIGHT, lastMoveAt: 0 })

    win.on('ready-to-show', () => {
      if (!win.isDestroyed() && USE_CONTENT_BOUNDS_MOVE) {
        const { width, height } = win.getContentBounds()
        const state = this.windowState.get(tabId)
        if (state) {
          state.width = width
          state.height = height
        }
      }
    })

    if (USE_CONTENT_BOUNDS_MOVE) {
      win.on('resize', () => {
        if (win.isDestroyed()) return
        const state = this.windowState.get(tabId)
        if (!state || Date.now() - state.lastMoveAt < MOVE_RESIZE_IGNORE_MS) return
        const { width, height } = win.getContentBounds()
        state.width = width
        state.height = height
      })
    }

    win.on('closed', () => {
      this.windowState.delete(tabId)
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
  }) {
    const { id: tabId, url, title, isPinned, type, x, y } = payload

    const params = new URLSearchParams({
      url,
      tabId,
      title: title || '',
      type: type || 'route',
      isPinned: String(!!isPinned)
    })

    const hasPosition = x !== undefined && y !== undefined

    const win = new BrowserWindow({
      width: DETACHED_DEFAULT_WIDTH,
      height: DETACHED_DEFAULT_HEIGHT,
      minWidth: 400,
      minHeight: 300,
      ...(hasPosition ? { x, y } : {}),
      show: false,
      autoHideMenuBar: true,
      title: title || 'Cherry Studio Tab',
      icon,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      ...(isMac
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: { x: 8, y: 13 }
          }
        : {
            frame: false
          }),
      backgroundColor: isMac ? undefined : nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF',
      darkTheme: nativeTheme.shouldUseDarkColors,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        webviewTag: true,
        backgroundThrottling: false
      }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/detachedWindow.html?${params.toString()}`).catch((err) => {
        logger.error(`Failed to load detached window URL for tab ${tabId}`, err)
        this.windows.delete(tabId)
        if (!win.isDestroyed()) win.close()
      })
    } else {
      win
        .loadFile(join(__dirname, '../renderer/detachedWindow.html'), {
          search: params.toString()
        })
        .catch((err) => {
          logger.error(`Failed to load detached window file for tab ${tabId}`, err)
          this.windows.delete(tabId)
          if (!win.isDestroyed()) win.close()
        })
    }

    if (USE_CONTENT_BOUNDS_MOVE) {
      this.trackWindowSize(tabId, win)
    }

    win.on('ready-to-show', () => {
      if (!hasPosition) {
        win.show()
      }
    })

    win.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })

    win.on('closed', () => {
      this.windows.delete(tabId)
      this.windowUrls.delete(tabId)
    })

    this.windows.set(tabId, win)
    this.windowUrls.set(tabId, url)
    logger.info(`Created detached window for tab ${tabId}`, payload)

    return win
  }
}

import { is } from '@electron-toolkit/utils'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isLinux, isMac, isWin } from '@main/constant'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'

import icon from '../../../build/icon.png?asset'
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('DetachedWindowManager')

/** Height of the tab bar area used for drag-to-attach detection (must match CSS h-10) */
const TAB_BAR_HEIGHT = 40

/** Must match createWindow BrowserWindow width/height */
const DETACHED_DEFAULT_WIDTH = 800
const DETACHED_DEFAULT_HEIGHT = 600

/**
 * After Tab_MoveWindow, ignore `resize` bursts briefly so DPI rounding noise is not written back
 * into the content-size cache (would feed the next setContentBounds and re-trigger electron#27651).
 */
const MOVE_RESIZE_IGNORE_MS = 280

/** Win/Linux: move detached windows with setContentBounds + cached size (see electron#27651). */
const USE_CONTENT_BOUNDS_MOVE = isWin || isLinux

@Injectable('DetachedWindowManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService'])
export class DetachedWindowManager extends BaseService {
  private windows: Map<string, BrowserWindow> = new Map()

  /** Client/content size for setContentBounds during drag — never read from the window inside move IPC. */
  private detachedContentSize = new Map<string, { width: number; height: number }>()
  private detachedLastMoveAt = new Map<string, number>()

  protected async onInit() {
    this.registerIpcHandlers()
  }

  private getWindowService() {
    return application.get('WindowService')
  }

  private registerIpcHandlers() {
    this.ipcOn(IpcChannel.Tab_Detach, (_, payload) => {
      this.createWindow(payload)
    })

    this.ipcHandle(IpcChannel.Tab_Attach, (event, payload) => {
      const mainWindow = this.getWindowService().getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        logger.warn('Tab_Attach failed: main window not available')
        return false
      }

      try {
        mainWindow.webContents.send(IpcChannel.Tab_Attach, payload)
      } catch (err: any) {
        logger.error('Tab_Attach failed: could not send to main window', err as Error)
        return false
      }

      // Only close sender after successful send
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (senderWindow && senderWindow !== mainWindow && !senderWindow.isDestroyed()) {
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
        if (USE_CONTENT_BOUNDS_MOVE) {
          const tabId = payload.tabId
          this.detachedLastMoveAt.set(tabId, Date.now())
          const size = this.detachedContentSize.get(tabId) ?? {
            width: DETACHED_DEFAULT_WIDTH,
            height: DETACHED_DEFAULT_HEIGHT
          }
          // electron#27651 (Windows): avoid outer getBounds/setBounds round-trips during drag.
          win.setContentBounds({ x, y, width: size.width, height: size.height })
        } else {
          // macOS: no reported #27651-style creep; move without touching size.
          win.setPosition(x, y)
        }
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
        const mainWindow = this.getWindowService().getMainWindow()
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
            mainWindow.webContents.send(IpcChannel.Tab_Attach, payload.tab)
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

    this.detachedContentSize.set(tabId, {
      width: DETACHED_DEFAULT_WIDTH,
      height: DETACHED_DEFAULT_HEIGHT
    })

    win.on('ready-to-show', () => {
      if (!win.isDestroyed() && USE_CONTENT_BOUNDS_MOVE) {
        const c = win.getContentBounds()
        this.detachedContentSize.set(tabId, { width: c.width, height: c.height })
      }
      if (!hasPosition) {
        win.show()
      }
    })

    if (USE_CONTENT_BOUNDS_MOVE) {
      win.on('resize', () => {
        if (win.isDestroyed()) return
        const last = this.detachedLastMoveAt.get(tabId) ?? 0
        if (Date.now() - last < MOVE_RESIZE_IGNORE_MS) return
        const c = win.getContentBounds()
        this.detachedContentSize.set(tabId, { width: c.width, height: c.height })
      })
    }

    win.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })

    win.on('closed', () => {
      this.windows.delete(tabId)
      this.detachedContentSize.delete(tabId)
      this.detachedLastMoveAt.delete(tabId)
    })

    this.windows.set(tabId, win)
    logger.info(`Created detached window for tab ${tabId}`, payload)

    return win
  }
}

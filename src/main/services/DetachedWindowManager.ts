import { is } from '@electron-toolkit/utils'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isMac } from '@main/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'path'

import icon from '../../../build/icon.png?asset'
import { loggerService } from './LoggerService'
import { windowService } from './WindowService'

const logger = loggerService.withContext('DetachedWindowManager')
const TAB_BAR_HEIGHT = 40

export class DetachedWindowManager {
  private windows: Map<string, BrowserWindow> = new Map()

  constructor() {
    this.registerIpc()
  }

  private registerIpc() {
    ipcMain.on(IpcChannel.Tab_Detach, (_, payload) => {
      this.createWindow(payload)
    })

    ipcMain.handle(IpcChannel.Tab_Attach, (_, payload) => {
      const mainWindow = windowService.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannel.Tab_Attach, payload)
      }
    })

    ipcMain.on(IpcChannel.Tab_MoveWindow, (_, payload: { tabId: string; x: number; y: number }) => {
      const win = this.windows.get(payload.tabId)
      if (win && !win.isDestroyed()) {
        win.setPosition(Math.round(payload.x), Math.round(payload.y))
        if (!win.isVisible()) {
          win.show()
        }
        if (win.getOpacity() !== 0.5) {
          win.setOpacity(0.5)
        }
      }
    })

    // Detached window drag back to main window: check if mouse is within the main window tab bar area
    ipcMain.handle(
      IpcChannel.Tab_TryAttach,
      (_, payload: { tab: { id: string }; screenX: number; screenY: number }) => {
        const mainWindow = windowService.getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) return false

        const bounds = mainWindow.getBounds()
        const tabBarHeight = TAB_BAR_HEIGHT

        const isOverTabBar =
          payload.screenX >= bounds.x &&
          payload.screenX <= bounds.x + bounds.width &&
          payload.screenY >= bounds.y &&
          payload.screenY <= bounds.y + tabBarHeight

        if (isOverTabBar) {
          mainWindow.webContents.send(IpcChannel.Tab_Attach, payload.tab)

          const detachedWin = this.windows.get(payload.tab.id)
          if (detachedWin && !detachedWin.isDestroyed()) {
            detachedWin.close()
          }
          return true
        }

        // Not merged, restore opacity
        const detachedWin = this.windows.get(payload.tab.id)
        if (detachedWin && !detachedWin.isDestroyed()) {
          detachedWin.setOpacity(1)
        }

        return false
      }
    )

    ipcMain.on(IpcChannel.Tab_DragEnd, (_, payload?: { tabId?: string }) => {
      if (payload?.tabId) {
        const win = this.windows.get(payload.tabId)
        if (win && !win.isDestroyed()) {
          win.setOpacity(1)
        }
      }
      logger.info('Tab drag end', payload)
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
      width: 800,
      height: 600,
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
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/detachedWindow.html?${params.toString()}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/detachedWindow.html'), {
        search: params.toString()
      })
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
    })

    this.windows.set(tabId, win)
    logger.info(`Created detached window for tab ${tabId}`, payload)

    return win
  }
}

export const detachedWindowManager = new DetachedWindowManager()

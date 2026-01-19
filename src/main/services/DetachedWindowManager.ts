import { is } from '@electron-toolkit/utils'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isMac } from '@main/constant'
import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'path'

import icon from '../../../build/icon.png?asset'
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('DetachedWindowManager')

export class DetachedWindowManager {
  private windows: Map<string, BrowserWindow> = new Map()

  constructor() {
    this.registerIpc()
  }

  private registerIpc() {
    ipcMain.on('tab:detach', (_, payload) => {
      this.createWindow(payload)
    })
  }

  public createWindow(payload: any) {
    const { tabId, url, title, isPinned, type } = payload

    // 基础参数构建
    const params = new URLSearchParams({
      url,
      tabId,
      title: title || '',
      type: type || 'route',
      isPinned: String(!!isPinned)
    })

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      show: false, // Wait for ready-to-show
      autoHideMenuBar: true,
      title: title || 'Cherry Studio Tab',
      icon,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      // For Windows and Linux, we use frameless window with custom controls
      // For Mac, we keep the native title bar style
      ...(isMac
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: { x: 8, y: 13 }
          }
        : {
            frame: false // Frameless window for Windows and Linux
          }),
      backgroundColor: isMac ? undefined : nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF',
      darkTheme: nativeTheme.shouldUseDarkColors,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false, // 根据需求调整
        webviewTag: true,
        backgroundThrottling: false
      }
    })

    // 加载 detachedWindow.html
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/detachedWindow.html?${params.toString()}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/detachedWindow.html'), {
        search: params.toString()
      })
    }

    win.on('ready-to-show', () => {
      win.show()
    })

    // 处理窗口打开链接
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
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

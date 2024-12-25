import { is } from '@electron-toolkit/utils'
import { isLinux, isWin } from '@main/constant'
import { app, BrowserWindow, Menu, MenuItem, shell } from 'electron'
import Logger from 'electron-log'
import windowStateKeeper from 'electron-window-state'
import path, { join } from 'path'

import icon from '../../../build/icon.png?asset'
import { titleBarOverlayDark, titleBarOverlayLight } from '../config'
import { locales } from '../utils/locales'
import { configManager } from './ConfigManager'

export class WindowService {
  private static instance: WindowService | null = null
  private mainWindow: BrowserWindow | null = null

  public static getInstance(): WindowService {
    if (!WindowService.instance) {
      WindowService.instance = new WindowService()
    }
    return WindowService.instance
  }

  public createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow
    }

    const mainWindowState = windowStateKeeper({
      defaultWidth: 1080,
      defaultHeight: 670
    })

    const theme = configManager.getTheme()
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'

    this.mainWindow = new BrowserWindow({
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: 1080,
      minHeight: 600,
      show: true,
      autoHideMenuBar: true,
      transparent: isMac,
      vibrancy: 'under-window',
      visualEffectState: 'active',
      titleBarStyle: isLinux ? 'default' : 'hidden',
      titleBarOverlay: theme === 'dark' ? titleBarOverlayDark : titleBarOverlayLight,
      backgroundColor: isMac ? undefined : theme === 'dark' ? '#181818' : '#FFFFFF',
      trafficLightPosition: { x: 8, y: 12 },
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        webviewTag: true
      }
    })

    this.setupMainWindow(this.mainWindow, mainWindowState)
    return this.mainWindow
  }

  public createMinappWindow({
    url,
    parent,
    windowOptions
  }: {
    url: string
    parent?: BrowserWindow
    windowOptions?: Electron.BrowserWindowConstructorOptions
  }): BrowserWindow {
    const width = windowOptions?.width || 1000
    const height = windowOptions?.height || 680

    const minappWindow = new BrowserWindow({
      width,
      height,
      autoHideMenuBar: true,
      title: 'Cherry Studio',
      ...windowOptions,
      parent,
      webPreferences: {
        preload: join(__dirname, '../preload/minapp.js'),
        sandbox: false,
        contextIsolation: false
      }
    })

    minappWindow.loadURL(url)
    return minappWindow
  }

  private setupMainWindow(mainWindow: BrowserWindow, mainWindowState: any) {
    mainWindowState.manage(mainWindow)

    this.setupContextMenu(mainWindow)
    this.setupWindowEvents(mainWindow)
    this.setupWebContentsHandlers(mainWindow)
    this.setupWindowLifecycleEvents(mainWindow)
    this.loadMainWindowContent(mainWindow)
  }

  private setupContextMenu(mainWindow: BrowserWindow) {
    mainWindow.webContents.on('context-menu', () => {
      const locale = locales[configManager.getLanguage()]
      const { common } = locale.translation

      const menu = new Menu()
      menu.append(new MenuItem({ label: common.copy, role: 'copy' }))
      menu.append(new MenuItem({ label: common.paste, role: 'paste' }))
      menu.append(new MenuItem({ label: common.cut, role: 'cut' }))
      menu.popup()
    })
  }

  private setupWindowEvents(mainWindow: BrowserWindow) {
    mainWindow.on('ready-to-show', () => {
      mainWindow.show()
    })
  }

  private setupWebContentsHandlers(mainWindow: BrowserWindow) {
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.includes('localhost:5173')) {
        return
      }

      event.preventDefault()
      shell.openExternal(url)
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      const { url } = details

      if (url.includes('http://file/')) {
        const fileName = url.replace('http://file/', '')
        const storageDir = path.join(app.getPath('userData'), 'Data', 'Files')
        const filePath = storageDir + '/' + fileName
        shell.openPath(filePath).catch((err) => Logger.error('Failed to open file:', err))
      } else {
        shell.openExternal(details.url)
      }

      return { action: 'deny' }
    })

    this.setupWebRequestHeaders(mainWindow)
  }

  private setupWebRequestHeaders(mainWindow: BrowserWindow) {
    mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      if (details.responseHeaders?.['X-Frame-Options']) {
        delete details.responseHeaders['X-Frame-Options']
      }
      if (details.responseHeaders?.['x-frame-options']) {
        delete details.responseHeaders['x-frame-options']
      }
      if (details.responseHeaders?.['Content-Security-Policy']) {
        delete details.responseHeaders['Content-Security-Policy']
      }
      if (details.responseHeaders?.['content-security-policy']) {
        delete details.responseHeaders['content-security-policy']
      }
      callback({ cancel: false, responseHeaders: details.responseHeaders })
    })
  }

  private loadMainWindowContent(mainWindow: BrowserWindow) {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  private setupWindowLifecycleEvents(mainWindow: BrowserWindow) {
    mainWindow.on('close', (event) => {
      const notInTray = !configManager.isTray()

      // Windows and Linux
      if ((isWin || isLinux) && notInTray) {
        return app.quit()
      }

      // Mac
      if (!app.isQuitting) {
        event.preventDefault()
        mainWindow.hide()
      }
    })
  }

  public showMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        return this.mainWindow.restore()
      }
      this.mainWindow.show()
      this.mainWindow.focus()
    } else {
      this.createMainWindow()
    }
  }
}

export const windowService = WindowService.getInstance()

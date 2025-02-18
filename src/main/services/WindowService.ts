import { is } from '@electron-toolkit/utils'
import { isLinux, isWin } from '@main/constant'
import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell } from 'electron'
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
  private miniWindow: BrowserWindow | null = null
  private wasFullScreen: boolean = false
  private selectionMenuWindow: BrowserWindow | null = null
  private lastSelectedText: string = ''
  private contextMenu: Menu | null = null

  public static getInstance(): WindowService {
    if (!WindowService.instance) {
      WindowService.instance = new WindowService()
    }
    return WindowService.instance
  }

  public createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show()
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
      show: false, // 初始不显示
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
        webviewTag: true,
        allowRunningInsecureContent: true
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
    if (!this.contextMenu) {
      const locale = locales[configManager.getLanguage()]
      const { common } = locale.translation

      this.contextMenu = new Menu()
      this.contextMenu.append(new MenuItem({ label: common.copy, role: 'copy' }))
      this.contextMenu.append(new MenuItem({ label: common.paste, role: 'paste' }))
      this.contextMenu.append(new MenuItem({ label: common.cut, role: 'cut' }))
    }

    mainWindow.webContents.on('context-menu', () => {
      this.contextMenu?.popup()
    })

    // Handle webview context menu
    mainWindow.webContents.on('did-attach-webview', (_, webContents) => {
      webContents.on('context-menu', () => {
        this.contextMenu?.popup()
      })
    })
  }

  private setupWindowEvents(mainWindow: BrowserWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })

    // 处理全屏相关事件
    mainWindow.on('enter-full-screen', () => {
      this.wasFullScreen = true
      mainWindow.webContents.send('fullscreen-status-changed', true)
    })

    mainWindow.on('leave-full-screen', () => {
      this.wasFullScreen = false
      mainWindow.webContents.send('fullscreen-status-changed', false)
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

      const oauthProviderUrls = [
        'https://account.siliconflow.cn/oauth',
        'https://cloud.siliconflow.cn/expensebill',
        'https://aihubmix.com/token',
        'https://aihubmix.com/topup'
      ]

      if (oauthProviderUrls.some((link) => url.startsWith(link))) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              partition: 'persist:webview'
            }
          }
        }
      }

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
      // 如果已经触发退出，直接退出
      if (app.isQuitting) {
        return app.quit()
      }

      // 没有开启托盘，且是Windows或Linux系统，直接退出
      const notInTray = !configManager.getTray()
      if ((isWin || isLinux) && notInTray) {
        return app.quit()
      }

      // 如果是全屏状态，直接退出
      if (this.wasFullScreen) {
        return app.quit()
      }

      event.preventDefault()
      mainWindow.hide()
    })

    mainWindow.on('closed', () => {
      this.mainWindow = null
    })

    mainWindow.on('show', () => {
      if (this.miniWindow && !this.miniWindow.isDestroyed()) {
        this.miniWindow.hide()
      }
    })
  }

  public showMainWindow() {
    if (this.miniWindow && !this.miniWindow.isDestroyed()) {
      this.miniWindow.hide()
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.show()
      this.mainWindow.focus()
    } else {
      this.mainWindow = this.createMainWindow()
      this.mainWindow.focus()
    }
  }

  public showMiniWindow() {
    const enableQuickAssistant = configManager.getEnableQuickAssistant()

    if (!enableQuickAssistant) {
      return
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.hide()
    }
    if (this.selectionMenuWindow && !this.selectionMenuWindow.isDestroyed()) {
      this.selectionMenuWindow.hide()
    }

    if (this.miniWindow && !this.miniWindow.isDestroyed()) {
      if (this.miniWindow.isMinimized()) {
        this.miniWindow.restore()
      }
      this.miniWindow.show()
      this.miniWindow.center()
      this.miniWindow.focus()
      return
    }

    const isMac = process.platform === 'darwin'

    this.miniWindow = new BrowserWindow({
      width: 500,
      height: 520,
      show: true,
      autoHideMenuBar: true,
      transparent: isMac,
      vibrancy: 'under-window',
      visualEffectState: 'followWindow',
      center: true,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      useContentSize: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        webviewTag: true
      }
    })

    this.miniWindow.on('blur', () => {
      this.miniWindow?.hide()
    })

    this.miniWindow.on('closed', () => {
      this.miniWindow = null
    })

    this.miniWindow.on('hide', () => {
      this.miniWindow?.webContents.send('hide-mini-window')
    })

    this.miniWindow.on('show', () => {
      this.miniWindow?.webContents.send('show-mini-window')
    })

    ipcMain.on('miniwindow-reload', () => {
      this.miniWindow?.reload()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.miniWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/mini')
    } else {
      this.miniWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '#/mini'
      })
    }
  }

  public hideMiniWindow() {
    this.miniWindow?.hide()
  }

  public closeMiniWindow() {
    this.miniWindow?.close()
  }

  public toggleMiniWindow() {
    if (this.miniWindow) {
      this.miniWindow.isVisible() ? this.miniWindow.hide() : this.miniWindow.show()
    } else {
      this.showMiniWindow()
    }
  }

  public showSelectionMenu(bounds: { x: number; y: number }) {
    if (this.selectionMenuWindow && !this.selectionMenuWindow.isDestroyed()) {
      this.selectionMenuWindow.setPosition(bounds.x, bounds.y)
      this.selectionMenuWindow.show()
      return
    }

    const theme = configManager.getTheme()
    const isMac = process.platform === 'darwin'

    this.selectionMenuWindow = new BrowserWindow({
      width: 280,
      height: 40,
      x: bounds.x,
      y: bounds.y,
      show: true,
      autoHideMenuBar: true,
      transparent: true,
      frame: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      backgroundColor: isMac ? undefined : theme === 'dark' ? '#181818' : '#FFFFFF',
      resizable: false,
      vibrancy: 'popover',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false
      }
    })

    // 点击其他地方时隐藏窗口
    this.selectionMenuWindow.on('blur', () => {
      this.selectionMenuWindow?.hide()
      this.miniWindow?.webContents.send('selection-action', {
        action: 'home',
        selectedText: this.lastSelectedText
      })
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.selectionMenuWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/src/windows/menu/menu.html')
    } else {
      this.selectionMenuWindow.loadFile(join(__dirname, '../renderer/src/windows/menu/menu.html'))
    }

    this.setupSelectionMenuEvents()
  }

  private setupSelectionMenuEvents() {
    if (!this.selectionMenuWindow) return

    ipcMain.removeHandler('selection-menu:action')
    ipcMain.handle('selection-menu:action', (_, action) => {
      this.selectionMenuWindow?.hide()
      this.showMiniWindow()
      setTimeout(() => {
        this.miniWindow?.webContents.send('selection-action', {
          action,
          selectedText: this.lastSelectedText
        })
      }, 100)
    })
  }

  public setLastSelectedText(text: string) {
    this.lastSelectedText = text
  }
}

export const windowService = WindowService.getInstance()

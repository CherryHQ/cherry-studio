import { is } from '@electron-toolkit/utils'
import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { getFilesDir } from '@main/utils/file'
import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell } from 'electron'
import Logger from 'electron-log'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'

import icon from '../../../build/icon.png?asset'
import { titleBarOverlayDark, titleBarOverlayLight } from '../config'
import { locales } from '../utils/locales'
import { configManager } from './ConfigManager'
import { IpcChannel } from '@shared/IpcChannel'

export class WindowService {
  private static instance: WindowService | null = null
  private mainWindow: BrowserWindow | null = null
  private miniWindow: BrowserWindow | null = null
  private isPinnedMiniWindow: boolean = false
  private wasFullScreen: boolean = false
  //hacky-fix: store the focused status of mainWindow before miniWindow shows
  //to restore the focus status when miniWindow hides
  private wasMainWindowFocused: boolean = false
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
      this.mainWindow.focus()
      return this.mainWindow
    }

    const mainWindowState = windowStateKeeper({
      defaultWidth: 1080,
      defaultHeight: 670
    })

    const theme = configManager.getTheme()

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
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      titleBarStyle: isLinux ? 'default' : 'hidden',
      titleBarOverlay: theme === 'dark' ? titleBarOverlayDark : titleBarOverlayLight,
      backgroundColor: isMac ? undefined : theme === 'dark' ? '#181818' : '#FFFFFF',
      trafficLightPosition: { x: 8, y: 12 },
      ...(isLinux ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        webviewTag: true,
        allowRunningInsecureContent: true
      }
    })

    this.setupMainWindow(this.mainWindow, mainWindowState)

    //preload miniWindow to resolve series of issues about miniWindow in Mac
    const enableQuickAssistant = configManager.getEnableQuickAssistant()
    if (enableQuickAssistant && !this.miniWindow) {
      this.miniWindow = this.createMiniWindow(true)
    }

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

    // Dangerous API
    if (isDev) {
      mainWindow.webContents.on('will-attach-webview', (_, webPreferences) => {
        webPreferences.preload = join(__dirname, '../preload/index.js')
      })
    }

    // Handle webview context menu
    mainWindow.webContents.on('did-attach-webview', (_, webContents) => {
      webContents.on('context-menu', () => {
        this.contextMenu?.popup()
      })
    })
  }

  private setupWindowEvents(mainWindow: BrowserWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.webContents.setZoomFactor(configManager.getZoomFactor())

      // show window only when laucn to tray not set
      const isLaunchToTray = configManager.getLaunchToTray()
      if (!isLaunchToTray) {
        //[mac]hacky-fix: miniWindow set visibleOnFullScreen:true will cause dock icon disappeared
        app.dock?.show()
        mainWindow.show()
      }
    })

    // 处理全屏相关事件
    mainWindow.on('enter-full-screen', () => {
      this.wasFullScreen = true
      mainWindow.webContents.send(IpcChannel.FullscreenStatusChanged, true)
    })

    mainWindow.on('leave-full-screen', () => {
      this.wasFullScreen = false
      mainWindow.webContents.send(IpcChannel.FullscreenStatusChanged, false)
    })

    // set the zoom factor again when the window is going to resize
    //
    // this is a workaround for the known bug that
    // the zoom factor is reset to cached value when window is resized after routing to other page
    // see: https://github.com/electron/electron/issues/10572
    //
    mainWindow.on('will-resize', () => {
      mainWindow.webContents.setZoomFactor(configManager.getZoomFactor())
    })

    // ARCH: as `will-resize` is only for Win & Mac,
    // linux has the same problem, use `resize` listener instead
    // but `resize` will fliker the ui
    if (isLinux) {
      mainWindow.on('resize', () => {
        mainWindow.webContents.setZoomFactor(configManager.getZoomFactor())
      })
    }

    // 添加Escape键退出全屏的支持
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // 当按下Escape键且窗口处于全屏状态时退出全屏
      if (input.key === 'Escape' && !input.alt && !input.control && !input.meta && !input.shift) {
        if (mainWindow.isFullScreen()) {
          event.preventDefault()
          mainWindow.setFullScreen(false)
        }
      }
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
        const storageDir = getFilesDir()
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

      // 托盘及关闭行为设置
      const isShowTray = configManager.getTray()
      const isTrayOnClose = configManager.getTrayOnClose()

      // 没有开启托盘，或者开启了托盘，但设置了直接关闭，应执行直接退出
      if (!isShowTray || (isShowTray && !isTrayOnClose)) {
        // 如果是Windows或Linux，直接退出
        // mac按照系统默认行为，不退出
        if (isWin || isLinux) {
          return app.quit()
        }
      }

      //上述逻辑以下，是“开启托盘+设置关闭时最小化到托盘”的情况
      // 如果是Windows或Linux，且处于全屏状态，则退出应用
      if (this.wasFullScreen) {
        if (isWin || isLinux) {
          return app.quit()
        } else {
          event.preventDefault()
          mainWindow.setFullScreen(false)
          return
        }
      }

      event.preventDefault()
      mainWindow.hide()

      //for mac users, should hide dock icon if close to tray
      app.dock?.hide()
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
        return
      }
      //[macOS] Known Issue
      // setVisibleOnAllWorkspaces true/false will NOT bring window to current desktop in Mac (works fine with Windows)
      // AppleScript may be a solution, but it's not worth
      this.mainWindow.setVisibleOnAllWorkspaces(true)
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.setVisibleOnAllWorkspaces(false)
    } else {
      this.mainWindow = this.createMainWindow()
    }
  }

  public toggleMainWindow() {
    // should not toggle main window when in full screen
    if (this.wasFullScreen) {
      return
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
      if (this.mainWindow.isFocused()) {
        // if tray is enabled, hide the main window, else do nothing
        if (configManager.getTray()) {
          this.mainWindow.hide()
          app.dock?.hide()
        }
      } else {
        this.mainWindow.focus()
      }
      return
    }

    this.showMainWindow()
  }

  public createMiniWindow(isPreload: boolean = false): BrowserWindow {
    this.miniWindow = new BrowserWindow({
      width: 550,
      height: 400,
      minWidth: 350,
      minHeight: 380,
      maxWidth: 1024,
      maxHeight: 768,
      show: false,
      autoHideMenuBar: true,
      transparent: isMac,
      vibrancy: 'under-window',
      visualEffectState: 'followWindow',
      center: true,
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      useContentSize: true,
      ...(isMac ? { type: 'panel' } : {}),
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        webviewTag: true
      }
    })

    //miniWindow should show in current desktop
    this.miniWindow?.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    //make miniWindow always on top of fullscreen apps with level set
    this.miniWindow.setAlwaysOnTop(true, 'screen-saver', 1)

    this.miniWindow.on('ready-to-show', () => {
      if (isPreload) {
        return
      }

      this.wasMainWindowFocused = this.mainWindow?.isFocused() || false
      this.miniWindow?.center()
      this.miniWindow?.show()
    })

    this.miniWindow.on('blur', () => {
      if (!this.isPinnedMiniWindow) {
        this.hideMiniWindow()
      }
    })

    this.miniWindow.on('closed', () => {
      this.miniWindow = null
    })

    this.miniWindow.on('hide', () => {
      this.miniWindow?.webContents.send(IpcChannel.HideMiniWindow)
    })

    this.miniWindow.on('show', () => {
      this.miniWindow?.webContents.send(IpcChannel.ShowMiniWindow)
    })

    ipcMain.on(IpcChannel.MiniWindowReload, () => {
      this.miniWindow?.reload()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.miniWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/mini')
    } else {
      this.miniWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '#/mini'
      })
    }

    return this.miniWindow
  }

  public showMiniWindow() {
    const enableQuickAssistant = configManager.getEnableQuickAssistant()

    if (!enableQuickAssistant) {
      return
    }

    if (this.selectionMenuWindow && !this.selectionMenuWindow.isDestroyed()) {
      this.selectionMenuWindow.hide()
    }

    if (this.miniWindow && !this.miniWindow.isDestroyed()) {
      this.wasMainWindowFocused = this.mainWindow?.isFocused() || false

      if (this.miniWindow.isMinimized()) {
        this.miniWindow.restore()
      }
      this.miniWindow.show()
      return
    }

    this.miniWindow = this.createMiniWindow()
  }

  public hideMiniWindow() {
    //hacky-fix:[mac/win] previous window(not self-app) should be focused again after miniWindow hide
    if (isWin) {
      this.miniWindow?.minimize()
      this.miniWindow?.hide()
      return
    } else if (isMac) {
      this.miniWindow?.hide()
      if (!this.wasMainWindowFocused) {
        app.hide()
      }
      return
    }

    this.miniWindow?.hide()
  }

  public closeMiniWindow() {
    this.miniWindow?.close()
  }

  public toggleMiniWindow() {
    if (this.miniWindow && !this.miniWindow.isDestroyed() && this.miniWindow.isVisible()) {
      this.hideMiniWindow()
      return
    }

    this.showMiniWindow()
  }

  public setPinMiniWindow(isPinned) {
    this.isPinnedMiniWindow = isPinned
  }

  public showSelectionMenu(bounds: { x: number; y: number }) {
    if (this.selectionMenuWindow && !this.selectionMenuWindow.isDestroyed()) {
      this.selectionMenuWindow.setPosition(bounds.x, bounds.y)
      this.selectionMenuWindow.show()
      return
    }

    const theme = configManager.getTheme()

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
      this.miniWindow?.webContents.send(IpcChannel.SelectionAction, {
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

    ipcMain.removeHandler(IpcChannel.SelectionMenu_Action)
    ipcMain.handle(IpcChannel.SelectionMenu_Action, (_, action) => {
      this.selectionMenuWindow?.hide()
      this.showMiniWindow()
      setTimeout(() => {
        this.miniWindow?.webContents.send(IpcChannel.SelectionAction, {
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

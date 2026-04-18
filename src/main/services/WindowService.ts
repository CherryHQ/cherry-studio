import { application } from '@application'
import { is, optimizer } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getWindowsBackgroundMaterial, replaceDevtoolsFont } from '@main/utils/windowUtil'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer'
import windowStateKeeper from 'electron-window-state'
import path, { join } from 'path'

import iconPath from '../../../build/icon.png?asset'
import { titleBarOverlayDark, titleBarOverlayLight } from '../config'
import { contextMenu } from './ContextMenu'
import { isSafeExternalUrl } from './security'

const logger = loggerService.withContext('WindowService')

// Create nativeImage for Linux window icon (required for Wayland)
const linuxIcon = isLinux ? nativeImage.createFromPath(iconPath) : undefined

@Injectable('WindowService')
@ServicePhase(Phase.WhenReady)
export class WindowService extends BaseService {
  private readonly _onMainWindowCreated: Emitter<BrowserWindow>
  public readonly onMainWindowCreated: Event<BrowserWindow>

  private mainWindow: BrowserWindow | null = null
  private lastRendererProcessCrashTime: number = 0

  constructor() {
    super()
    this._onMainWindowCreated = this.registerDisposable(new Emitter<BrowserWindow>())
    this.onMainWindowCreated = this._onMainWindowCreated.event
  }

  protected async onInit() {
    this.registerWindowShortcuts()
    this.registerIpcHandlers()
    this.registerActivateHandler()
    this.registerSecondInstanceHandler()
  }

  private registerWindowShortcuts() {
    const handler = (_: Electron.Event, window: BrowserWindow) => {
      optimizer.watchWindowShortcuts(window)
    }
    app.on('browser-window-created', handler)
    this.registerDisposable(() => app.removeListener('browser-window-created', handler))
  }

  protected async onReady() {
    // Mac: hide dock icon before window creation when launch to tray is set.
    // Dock icon is visible from app launch; must hide early.
    // The ready-to-show handler's app.dock?.show() restores it for non-tray mode.
    const isLaunchToTray = application.get('PreferenceService').get('app.tray.on_launch')
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    this.createMainWindow()

    // Install React Developer Tools extension for debugging in development mode
    if (isDev) {
      installExtension(REACT_DEVELOPER_TOOLS)
        .then((name) => logger.info(`Added Extension: ${name}`))
        .catch((err) => logger.error('An error occurred: ', err))
    }
  }

  private checkMainWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error('Main window does not exist or has been destroyed')
    }
  }

  private registerActivateHandler() {
    const handler = () => {
      const mainWindow = this.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        this.createMainWindow()
      } else {
        this.showMainWindow()
      }
    }
    app.on('activate', handler)
    this.registerDisposable(() => app.removeListener('activate', handler))
  }

  private registerSecondInstanceHandler() {
    // Protocol URL dispatch is handled by ProtocolService on the same event.
    // Multiple listeners on 'second-instance' are intentional: ProtocolService
    // dispatches the URL, WindowService restores the window.
    const handler = () => this.showMainWindow()
    app.on('second-instance', handler)
    this.registerDisposable(() => app.removeListener('second-instance', handler))
  }

  /**
   * Resolves the BrowserWindow that originated the IPC call.
   * Used for window-control channels (minimize/maximize/close) that must operate
   * on whichever window sent the IPC — main window or a detached tab window.
   * Throws if the sender cannot be mapped to a live window.
   */
  private resolveIpcSenderWindow(sender: Electron.WebContents): BrowserWindow {
    const win = BrowserWindow.fromWebContents(sender)
    if (win && !win.isDestroyed()) {
      return win
    }
    throw new Error('WindowService: could not resolve a live BrowserWindow from IPC sender')
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.Windows_SetMinimumSize, (_, width: number, height: number) => {
      this.checkMainWindow()
      this.mainWindow!.setMinimumSize(width, height)
    })

    this.ipcHandle(IpcChannel.Windows_ResetMinimumSize, () => {
      this.checkMainWindow()
      this.mainWindow!.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
      const [width, height] = this.mainWindow!.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
      if (width < MIN_WINDOW_WIDTH) {
        this.mainWindow!.setSize(MIN_WINDOW_WIDTH, height)
      }
    })

    this.ipcHandle(IpcChannel.Windows_GetSize, () => {
      this.checkMainWindow()
      const [width, height] = this.mainWindow!.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
      return [width, height]
    })

    this.ipcHandle(IpcChannel.Windows_Minimize, (event) => {
      this.resolveIpcSenderWindow(event.sender).minimize()
    })

    this.ipcHandle(IpcChannel.Windows_Maximize, (event) => {
      this.resolveIpcSenderWindow(event.sender).maximize()
    })

    this.ipcHandle(IpcChannel.Windows_Unmaximize, (event) => {
      this.resolveIpcSenderWindow(event.sender).unmaximize()
    })

    this.ipcHandle(IpcChannel.Windows_Close, (event) => {
      this.resolveIpcSenderWindow(event.sender).close()
    })

    this.ipcHandle(IpcChannel.Windows_IsMaximized, (event) => {
      return this.resolveIpcSenderWindow(event.sender).isMaximized()
    })

    this.ipcHandle(IpcChannel.App_QuoteToMain, (_, text: string) => this.quoteToMainWindow(text))
  }

  public createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show()
      this.mainWindow.focus()
      return this.mainWindow
    }

    const preferenceService = application.get('PreferenceService')

    const mainWindowState = windowStateKeeper({
      defaultWidth: MIN_WINDOW_WIDTH,
      defaultHeight: MIN_WINDOW_HEIGHT,
      fullScreen: false,
      maximize: false
    })
    const windowsBackgroundMaterial = getWindowsBackgroundMaterial()
    let mainWindowBackgroundColor: string | undefined

    if (!isMac && !windowsBackgroundMaterial) {
      mainWindowBackgroundColor = nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF'
    }

    this.mainWindow = new BrowserWindow({
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      // For Windows and Linux, we use frameless window with custom controls
      // For Mac, we keep the native title bar style
      ...(isMac
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: { x: 13, y: 16 }
          }
        : {
            // On Linux, allow using system title bar if setting is enabled
            frame: isLinux && preferenceService.get('app.use_system_title_bar')
          }),
      ...(windowsBackgroundMaterial ? { backgroundMaterial: windowsBackgroundMaterial } : {}),
      ...(mainWindowBackgroundColor ? { backgroundColor: mainWindowBackgroundColor } : {}),
      darkTheme: nativeTheme.shouldUseDarkColors,
      ...(isLinux ? { icon: linuxIcon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        webviewTag: true,
        allowRunningInsecureContent: true,
        zoomFactor: preferenceService.get('app.zoom_factor'),
        backgroundThrottling: false
      }
    })

    this.setupMainWindow(this.mainWindow, mainWindowState)

    this._onMainWindowCreated.fire(this.mainWindow)

    return this.mainWindow
  }

  private setupMainWindow(mainWindow: BrowserWindow, mainWindowState: any) {
    mainWindowState.manage(mainWindow)

    this.setupMaximize(mainWindow, mainWindowState.isMaximized)
    this.setupContextMenu(mainWindow)
    this.setupSpellCheck(mainWindow)
    this.setupWindowEvents(mainWindow)
    this.setupWebContentsHandlers(mainWindow)
    this.setupWindowLifecycleEvents(mainWindow)
    this.setupMainWindowMonitor(mainWindow)
    replaceDevtoolsFont(mainWindow)
    this.loadMainWindowContent(mainWindow)
  }

  private setupSpellCheck(mainWindow: BrowserWindow) {
    const preferenceService = application.get('PreferenceService')
    const enableSpellCheck = preferenceService.get('app.spell_check.enabled')
    if (enableSpellCheck) {
      try {
        const spellCheckLanguages = preferenceService.get('app.spell_check.languages')
        spellCheckLanguages.length > 0 && mainWindow.webContents.session.setSpellCheckerLanguages(spellCheckLanguages)
      } catch (error) {
        logger.error('Failed to set spell check languages:', error as Error)
      }
    }
  }

  private setupMainWindowMonitor(mainWindow: BrowserWindow) {
    mainWindow.webContents.on('render-process-gone', (_, details) => {
      logger.error(`Renderer process crashed with: ${JSON.stringify(details)}`)
      const currentTime = Date.now()
      const lastCrashTime = this.lastRendererProcessCrashTime
      this.lastRendererProcessCrashTime = currentTime
      if (currentTime - lastCrashTime > 60 * 1000) {
        // 如果大于1分钟，则重启渲染进程
        mainWindow.webContents.reload()
      } else {
        // 如果小于1分钟，则退出应用, 可能是连续crash，需要退出应用
        application.forceExit(1)
      }
    })
  }

  private setupMaximize(mainWindow: BrowserWindow, isMaximized: boolean) {
    if (isMaximized) {
      // 如果是从托盘启动，则需要延迟最大化，否则显示的就不是重启前的最大化窗口了
      application.get('PreferenceService').get('app.tray.on_launch')
        ? mainWindow.once('show', () => {
            mainWindow.maximize()
          })
        : mainWindow.maximize()
    }
  }

  private setupContextMenu(mainWindow: BrowserWindow) {
    contextMenu.contextMenu(mainWindow.webContents)
    // setup context menu for all webviews like miniapp
    app.on('web-contents-created', (_, webContents) => {
      contextMenu.contextMenu(webContents)
    })

    // Dangerous API
    if (isDev) {
      mainWindow.webContents.on('will-attach-webview', (_, webPreferences) => {
        webPreferences.preload = join(__dirname, '../preload/index.js')
      })
    }
  }

  private setupWindowEvents(mainWindow: BrowserWindow) {
    mainWindow.once('ready-to-show', () => {
      const preferenceService = application.get('PreferenceService')
      mainWindow.webContents.setZoomFactor(preferenceService.get('app.zoom_factor'))

      // show window only when laucn to tray not set
      const isLaunchToTray = preferenceService.get('app.tray.on_launch')
      if (!isLaunchToTray) {
        //[mac]hacky-fix: miniWindow set visibleOnFullScreen:true will cause dock icon disappeared
        void app.dock?.show()
        mainWindow.show()
      }
    })

    // 处理全屏相关事件
    mainWindow.on('enter-full-screen', () => {
      mainWindow.webContents.send(IpcChannel.FullscreenStatusChanged, true)
    })

    mainWindow.on('leave-full-screen', () => {
      mainWindow.webContents.send(IpcChannel.FullscreenStatusChanged, false)
    })

    // set the zoom factor again when the window is going to resize
    //
    // this is a workaround for the known bug that
    // the zoom factor is reset to cached value when window is resized after routing to other page
    // see: https://github.com/electron/electron/issues/10572
    //
    // and resize ipc
    //
    mainWindow.on('will-resize', () => {
      mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
      mainWindow.webContents.send(IpcChannel.Windows_Resize, mainWindow.getSize())
    })

    // set the zoom factor again when the window is going to restore
    // minimize and restore will cause zoom reset
    mainWindow.on('restore', () => {
      mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
    })

    // ARCH: as `will-resize` is only for Win & Mac,
    // linux has the same problem, use `resize` listener instead
    // but `resize` will fliker the ui
    if (isLinux) {
      mainWindow.on('resize', () => {
        mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
        mainWindow.webContents.send(IpcChannel.Windows_Resize, mainWindow.getSize())
      })
    }

    mainWindow.on('unmaximize', () => {
      mainWindow.webContents.send(IpcChannel.Windows_Resize, mainWindow.getSize())
      mainWindow.webContents.send(IpcChannel.Windows_MaximizedChanged, false)
    })

    mainWindow.on('maximize', () => {
      mainWindow.webContents.send(IpcChannel.Windows_Resize, mainWindow.getSize())
      mainWindow.webContents.send(IpcChannel.Windows_MaximizedChanged, true)
    })

    // 添加Escape键退出全屏的支持
    // mainWindow.webContents.on('before-input-event', (event, input) => {
    //   // 当按下Escape键且窗口处于全屏状态时退出全屏
    //   if (input.key === 'Escape' && !input.alt && !input.control && !input.meta && !input.shift) {
    //     if (mainWindow.isFullScreen()) {
    //       // 获取 shortcuts 配置
    //       const shortcuts = configManager.getShortcuts()
    //       const exitFullscreenShortcut = shortcuts.find((s) => s.key === 'exit_fullscreen')
    //       if (exitFullscreenShortcut == undefined) {
    //         mainWindow.setFullScreen(false)
    //         return
    //       }
    //       if (exitFullscreenShortcut?.enabled) {
    //         event.preventDefault()
    //         mainWindow.setFullScreen(false)
    //         return
    //       }
    //     }
    //   }
    //   return
    // })
  }

  private setupWebContentsHandlers(mainWindow: BrowserWindow) {
    // Fix for Electron bug where zoom resets during in-page navigation (route changes)
    // This complements the resize-based workaround by catching navigation events
    mainWindow.webContents.on('did-navigate-in-page', () => {
      mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
    })

    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.includes('localhost:517')) {
        return
      }

      event.preventDefault()
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warn(`Blocked navigation to untrusted URL scheme: ${url}`)
      }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      const { url } = details

      const oauthProviderUrls = [
        'https://account.siliconflow.cn/oauth',
        'https://cloud.siliconflow.cn/bills',
        'https://cloud.siliconflow.cn/expensebill',
        'https://console.aihubmix.com/token',
        'https://console.aihubmix.com/topup',
        'https://console.aihubmix.com/statistics',
        'https://dash.302.ai/sso/login',
        'https://dash.302.ai/charge',
        'https://maas.aiionly.com/login'
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
        if (!fileName) {
          logger.warn('Blocked empty file name in http://file/ URL')
          return { action: 'deny' }
        }
        const storageDir = application.getPath('feature.files.data')
        const filePath = path.resolve(storageDir, fileName)
        // Prevent path traversal: ensure resolved path is within storageDir
        if (!filePath.startsWith(path.resolve(storageDir) + path.sep)) {
          logger.warn(`Blocked path traversal attempt: ${fileName}`)
        } else {
          shell.openPath(filePath).catch((err) => logger.error('Failed to open file:', err))
        }
      } else if (isSafeExternalUrl(details.url)) {
        void shell.openExternal(details.url)
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${details.url}`)
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
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
      // mainWindow.webContents.openDevTools()
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public getAllWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  }

  private setupWindowLifecycleEvents(mainWindow: BrowserWindow) {
    mainWindow.on('close', (event) => {
      // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
      // try {
      //   mainWindow.webContents.send(IpcChannel.App_SaveData)
      // } catch (error) {
      //   logger.error('Failed to save data:', error as Error)
      // }

      // 如果已经触发退出，直接放行窗口关闭
      if (application.isQuitting) {
        return
      }

      // 托盘及关闭行为设置
      const preferenceService = application.get('PreferenceService')
      const isShowTray = preferenceService.get('app.tray.enabled')
      const isTrayOnClose = preferenceService.get('app.tray.on_close')

      // 没有开启托盘，或者开启了托盘，但设置了直接关闭，应执行直接退出
      if (!isShowTray || (isShowTray && !isTrayOnClose)) {
        // 如果是Windows或Linux，直接退出
        // mac按照系统默认行为，不退出
        if (isWin || isLinux) {
          return application.quit()
        }
      }

      /**
       * 上述逻辑以下:
       * win/linux: 是"开启托盘+设置关闭时最小化到托盘"的情况
       * mac: 任何情况都会到这里，因此需要单独处理mac
       */

      if (!mainWindow.isFullScreen()) {
        event.preventDefault()
      }

      mainWindow.hide()

      //for mac users, should hide dock icon if close to tray
      if (isMac && isTrayOnClose) {
        app.dock?.hide()

        mainWindow.once('show', () => {
          //restore the window can hide by cmd+h when the window is shown again
          // https://github.com/electron/electron/pull/47970
          void app.dock?.show()
        })
      }
    })

    mainWindow.on('closed', () => {
      this.mainWindow = null
    })
  }

  public showMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
        return
      }

      /**
       * [Linux] Special handling for window activation
       * When the window is visible but covered by other windows, simply calling show() and focus()
       * is not enough to bring it to the front. We need to hide it first, then show it again.
       * This mimics the "close to tray and reopen" behavior which works correctly.
       */
      if (isLinux && this.mainWindow.isVisible() && !this.mainWindow.isFocused()) {
        this.mainWindow.hide()
        setImmediate(() => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show()
            this.mainWindow.focus()
          }
        })
        return
      }

      /**
       * About setVisibleOnAllWorkspaces
       *
       * [macOS] Known Issue
       *  setVisibleOnAllWorkspaces true/false will NOT bring window to current desktop in Mac (works fine with Windows)
       *  AppleScript may be a solution, but it's not worth
       *
       * [Linux] Known Issue
       *  setVisibleOnAllWorkspaces 在 Linux 环境下（特别是 KDE Wayland）会导致窗口进入"假弹出"状态
       *  因此在 Linux 环境下不执行这两行代码
       */
      if (!isLinux) {
        this.mainWindow.setVisibleOnAllWorkspaces(true)
      }

      /**
       * [macOS] After being closed in fullscreen, the fullscreen behavior will become strange when window shows again
       * So we need to set it to FALSE explicitly.
       * althougle other platforms don't have the issue, but it's a good practice to do so
       *
       *  Check if window is visible to prevent interrupting fullscreen state when clicking dock icon
       */
      if (this.mainWindow.isFullScreen() && !this.mainWindow.isVisible()) {
        this.mainWindow.setFullScreen(false)
      }

      this.mainWindow.show()
      this.mainWindow.focus()
      if (!isLinux) {
        this.mainWindow.setVisibleOnAllWorkspaces(false)
      }
    } else {
      this.mainWindow = this.createMainWindow()
    }
  }

  public toggleMainWindow() {
    // should not toggle main window when in full screen
    // but if the main window is close to tray when it's in full screen, we can show it again
    // (it's a bug in macos, because we can close the window when it's in full screen, and the state will be remained)
    if (this.mainWindow?.isFullScreen() && this.mainWindow?.isVisible()) {
      return
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
      if (this.mainWindow.isFocused()) {
        // if tray is enabled, hide the main window, else do nothing
        if (application.get('PreferenceService').get('app.tray.on_close')) {
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

  /**
   * 引用文本到主窗口
   * @param text 原始文本（未格式化）
   */
  public quoteToMainWindow(text: string): void {
    try {
      this.showMainWindow()

      const mainWindow = this.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
          mainWindow.webContents.send(IpcChannel.App_QuoteToMain, text)
        }, 100)
      }
    } catch (error) {
      logger.error('Failed to quote to main window:', error as Error)
    }
  }
}

import { application } from '@application'
import { optimizer } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { getWindowsBackgroundMaterial, replaceDevtoolsFont } from '@main/utils/windowUtil'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { app, nativeImage, nativeTheme, shell } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer'
import windowStateKeeper from 'electron-window-state'
import path, { join } from 'path'

import iconPath from '../../../build/icon.png?asset'
import { titleBarOverlayDark, titleBarOverlayLight } from '../config'
import { isSafeExternalUrl } from '../utils/externalUrlSafety'
import { contextMenu } from './ContextMenu'

const logger = loggerService.withContext('MainWindowService')

// Create nativeImage for Linux window icon (required for Wayland)
const linuxIcon = isLinux ? nativeImage.createFromPath(iconPath) : undefined

@Injectable('MainWindowService')
@ServicePhase(Phase.WhenReady)
export class MainWindowService extends BaseService {
  private readonly _onMainWindowCreated: Emitter<BrowserWindow>
  public readonly onMainWindowCreated: Event<BrowserWindow>

  // Direct BrowserWindow reference, kept in sync with WindowManager's lifecycle
  // events (onWindowCreatedByType / onWindowDestroyedByType). External callers
  // should NOT touch this field — use WindowManager.broadcastToType() / showMainWindow()
  // / getWindowsByType(). The public getMainWindow() below is a deprecated
  // escape hatch that logs a warn on every call.
  private mainWindow: BrowserWindow | null = null
  private stateKeeper: ReturnType<typeof windowStateKeeper> | undefined
  private lastRendererProcessCrashTime: number = 0

  constructor() {
    super()
    this._onMainWindowCreated = this.registerDisposable(new Emitter<BrowserWindow>())
    this.onMainWindowCreated = this._onMainWindowCreated.event
  }

  protected async onInit() {
    const windowManager = application.get('WindowManager')

    // Wire business listeners onto fresh main windows. Reuse paths (singleton reopen)
    // do not fire onWindowCreatedByType — by design, since listeners are already attached.
    this.registerDisposable(
      windowManager.onWindowCreatedByType(WindowType.Main, ({ window }) => {
        this.mainWindow = window
        this.setupMainWindow(window)
        this._onMainWindowCreated.fire(window)
      })
    )
    this.registerDisposable(
      windowManager.onWindowDestroyedByType(WindowType.Main, () => {
        this.mainWindow = null
      })
    )

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
    // Mac: when launching into tray, suppress the Dock icon up-front by telling
    // WindowManager that Main-type windows do not contribute to Dock visibility.
    // WindowManager reads this override when the first Main window is created
    // (in createWindow's trailing updateDockVisibility), so the Dock is hidden
    // from the moment the app finishes launching.
    const isLaunchToTray = application.get('PreferenceService').get('app.tray.on_launch')
    if (isLaunchToTray) {
      application.get('WindowManager').behavior.setMacShowInDockByType(WindowType.Main, false)
    }

    this.openMainWindow()

    // Install React Developer Tools extension for debugging in development mode
    if (isDev) {
      installExtension(REACT_DEVELOPER_TOOLS)
        .then((name) => logger.info(`Added Extension: ${name}`))
        .catch((err) => logger.error('An error occurred: ', err))
    }
  }

  private requireMainWindow(): BrowserWindow {
    const mainWindow = this.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window does not exist or has been destroyed')
    }
    return mainWindow
  }

  private registerActivateHandler() {
    // showMainWindow's fallback re-opens via WindowManager when the previous window
    // has been destroyed; reuse path falls through to focus + restore.
    const handler = () => this.showMainWindow()
    app.on('activate', handler)
    this.registerDisposable(() => app.removeListener('activate', handler))
  }

  private registerSecondInstanceHandler() {
    // Protocol URL dispatch is handled by ProtocolService on the same event.
    // Multiple listeners on 'second-instance' are intentional: ProtocolService
    // dispatches the URL, MainWindowService restores the window.
    const handler = () => this.showMainWindow()
    app.on('second-instance', handler)
    this.registerDisposable(() => app.removeListener('second-instance', handler))
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.MainWindow_SetMinimumSize, (_, width: number, height: number) => {
      this.requireMainWindow().setMinimumSize(width, height)
    })

    this.ipcHandle(IpcChannel.MainWindow_ResetMinimumSize, () => {
      const mainWindow = this.requireMainWindow()
      mainWindow.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
      const [width, height] = mainWindow.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
      if (width < MIN_WINDOW_WIDTH) {
        mainWindow.setSize(MIN_WINDOW_WIDTH, height)
      }
    })

    this.ipcHandle(IpcChannel.App_QuoteToMain, (_, text: string) => this.quoteToMainWindow(text))

    // ─── Main-window-specific handlers migrated from src/main/ipc.ts ───
    // Each reads `this.mainWindow` at call time, so a main window that was
    // destroyed and rebuilt (singleton reopen path) is handled correctly.

    this.ipcHandle(IpcChannel.MainWindow_Reload, () => {
      this.mainWindow?.reload()
    })

    // Renderer tells main that a notification was clicked → broadcast the
    // click back to all main-window consumers. Distinct from the Electron
    // native-notification click path in NotificationService, which also
    // broadcasts 'notification-click'; both share the same bare-string
    // channel on the receiver side.
    this.ipcHandle(IpcChannel.Notification_OnClick, (_, notification) => {
      application.get('WindowManager').broadcastToType(WindowType.Main, 'notification-click', notification)
    })

    // Dev-only: force a renderer crash to test render-process-gone recovery
    // (see the render-process-gone handler in setupMainWindowMonitor).
    if (isDev) {
      this.ipcHandle(IpcChannel.MainWindow_CrashRenderProcess, () => {
        this.mainWindow?.webContents.forcefullyCrashRenderer()
      })
    }
  }

  /**
   * Open the main window via WindowManager.
   * Singleton lifecycle: reuses an existing main window if present (show + focus),
   * otherwise constructs a fresh one. Dynamic options (windowStateKeeper bounds,
   * theme-driven backgroundColor / titleBarOverlay / backgroundMaterial / Linux
   * frame and icon, zoom factor) are injected here at the call site, since the
   * registry only carries static defaults.
   */
  private openMainWindow(): void {
    const preferenceService = application.get('PreferenceService')
    const windowManager = application.get('WindowManager')

    // stateKeeper is initialized once per service lifetime. The internal window
    // listeners are (re)attached in setupMainWindow via stateKeeper.manage(window),
    // and old listeners die with the previous BrowserWindow on destroy.
    if (!this.stateKeeper) {
      this.stateKeeper = windowStateKeeper({
        defaultWidth: MIN_WINDOW_WIDTH,
        defaultHeight: MIN_WINDOW_HEIGHT,
        fullScreen: false,
        maximize: false
      })
    }

    const windowsBackgroundMaterial = getWindowsBackgroundMaterial()
    let mainWindowBackgroundColor: string | undefined
    if (!isMac && !windowsBackgroundMaterial) {
      mainWindowBackgroundColor = nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF'
    }

    // onWindowCreatedByType fires synchronously during open() on fresh-create,
    // and does nothing on singleton reuse (where this.mainWindow is already set).
    windowManager.open(WindowType.Main, {
      options: {
        x: this.stateKeeper.x,
        y: this.stateKeeper.y,
        width: this.stateKeeper.width,
        height: this.stateKeeper.height,
        darkTheme: nativeTheme.shouldUseDarkColors,
        ...(isMac && {
          titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight
        }),
        ...(isLinux && {
          frame: preferenceService.get('app.use_system_title_bar'),
          icon: linuxIcon
        }),
        ...(windowsBackgroundMaterial ? { backgroundMaterial: windowsBackgroundMaterial } : {}),
        ...(mainWindowBackgroundColor ? { backgroundColor: mainWindowBackgroundColor } : {}),
        webPreferences: {
          zoomFactor: preferenceService.get('app.zoom_factor')
        }
      }
    })
  }

  private setupMainWindow(mainWindow: BrowserWindow) {
    if (this.stateKeeper) {
      this.stateKeeper.manage(mainWindow)
      this.setupMaximize(mainWindow, this.stateKeeper.isMaximized)
    }

    this.setupContextMenu(mainWindow)
    this.setupSpellCheck(mainWindow)
    this.setupWindowEvents(mainWindow)
    this.setupWebContentsHandlers(mainWindow)
    this.setupWindowLifecycleEvents(mainWindow)
    this.setupMainWindowMonitor(mainWindow)
    replaceDevtoolsFont(mainWindow)
    // Content loading is handled by WindowManager via the registry's htmlPath.
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

      // showMode is 'manual' for the main window — first show is owned here.
      // tray-on-launch suppresses the initial show; otherwise restore Dock and show.
      const isLaunchToTray = preferenceService.get('app.tray.on_launch')
      if (!isLaunchToTray) {
        //[mac]hacky-fix: quickAssistant set visibleOnFullScreen:true will cause dock icon disappeared
        void app.dock?.show()
        mainWindow.show()
      }
    })

    // Workaround for electron#10572: zoom factor resets to the cached value when
    // the main window is resized after navigating to a new route. Re-apply the
    // user-configured zoom factor on every resize / restore so the page does not
    // visibly snap to the wrong scale.
    mainWindow.on('will-resize', () => {
      mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
    })

    mainWindow.on('restore', () => {
      mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
    })

    // `will-resize` only fires on Win & Mac; Linux uses `resize` instead (which
    // can cause UI flicker but is the only available signal).
    if (isLinux) {
      mainWindow.on('resize', () => {
        mainWindow.webContents.setZoomFactor(application.get('PreferenceService').get('app.zoom_factor'))
      })
    }

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

  /**
   * @deprecated External callers are almost always misusing this. For IPC use
   * `WindowManager.broadcastToType(WindowType.Main, channel, data)`; for
   * visibility use `showMainWindow()`; for existence checks use
   * `WindowManager.getWindowsByType(WindowType.Main)`. Slated for removal once
   * the remaining legacy callers (executeJavaScript deep links, ReduxService,
   * etc.) are rewritten in v2.
   *
   * Every call logs a warn — this is intentional, to keep pressure on
   * migration. Do NOT call this from within MainWindowService itself; use the
   * `this.mainWindow` field directly.
   */
  public getMainWindow(): BrowserWindow | null {
    logger.warn(
      'MainWindowService.getMainWindow() is deprecated. ' +
        'External callers should use WindowManager.broadcastToType() / showMainWindow() instead; ' +
        'grabbing a BrowserWindow instance from outside is almost always a misuse.'
    )
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null
    return this.mainWindow
  }

  public getAllWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  }

  private setupWindowLifecycleEvents(mainWindow: BrowserWindow) {
    mainWindow.on('close', (event) => {
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

      // macOS close-to-tray: opt Main windows out of Dock contribution BEFORE hiding.
      // This tells WindowManager "the app is now in tray mode" so the Dock icon goes
      // away too. Unlike the previous hard-coded app.dock?.hide(), this cooperates
      // with multi-window scenarios: if a SubWindow (or any other Dock-contributing
      // window) is still alive, it will keep the Dock visible. The override is lifted
      // in showMainWindow/toggleMainWindow when the user brings Main back.
      if (isMac && isTrayOnClose) {
        application.get('WindowManager').behavior.setMacShowInDockByType(WindowType.Main, false)
      }

      mainWindow.hide()
    })
    // No 'closed' handler — WM emits onWindowDestroyedByType which clears this.mainWindow.
  }

  public showMainWindow() {
    // Lift any close-to-tray override so the Dock icon reappears as the user
    // brings the main window back. Idempotent when the app is not currently
    // in tray mode — WM deduplicates via its dockShouldBeVisible flag.
    application.get('WindowManager').behavior.setMacShowInDockByType(WindowType.Main, true)

    const mainWindow = this.mainWindow
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
        return
      }

      /**
       * [Linux] Special handling for window activation
       * When the window is visible but covered by other windows, simply calling show() and focus()
       * is not enough to bring it to the front. We need to hide it first, then show it again.
       * This mimics the "close to tray and reopen" behavior which works correctly.
       */
      if (isLinux && mainWindow.isVisible() && !mainWindow.isFocused()) {
        mainWindow.hide()
        setImmediate(() => {
          // Re-check through the field — the window may have been destroyed
          // between hide() and this tick (e.g. user quit via tray).
          const w = this.mainWindow
          if (w && !w.isDestroyed()) {
            w.show()
            w.focus()
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
        mainWindow.setVisibleOnAllWorkspaces(true)
      }

      /**
       * [macOS] After being closed in fullscreen, the fullscreen behavior will become strange when window shows again
       * So we need to set it to FALSE explicitly.
       * althougle other platforms don't have the issue, but it's a good practice to do so
       *
       *  Check if window is visible to prevent interrupting fullscreen state when clicking dock icon
       */
      if (mainWindow.isFullScreen() && !mainWindow.isVisible()) {
        mainWindow.setFullScreen(false)
      }

      mainWindow.show()
      mainWindow.focus()
      if (!isLinux) {
        mainWindow.setVisibleOnAllWorkspaces(false)
      }
    } else {
      // Singleton: WM creates a fresh window when none exists; openMainWindow re-injects
      // the dynamic options (windowState bounds, theme, zoom) since the registry only carries statics.
      this.openMainWindow()
    }
  }

  public toggleMainWindow() {
    const mainWindow = this.mainWindow
    // should not toggle main window when in full screen
    // but if the main window is close to tray when it's in full screen, we can show it again
    // (it's a bug in macos, because we can close the window when it's in full screen, and the state will be remained)
    if (mainWindow?.isFullScreen() && mainWindow?.isVisible()) {
      return
    }

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        // if tray is enabled, hide the main window, else do nothing
        if (application.get('PreferenceService').get('app.tray.on_close')) {
          // Same pattern as the close handler: tell WM to stop counting Main
          // toward Dock visibility BEFORE hiding, so the Dock coordinates with
          // whatever else is alive (e.g. a SubWindow) rather than blindly hiding.
          if (isMac) {
            application.get('WindowManager').behavior.setMacShowInDockByType(WindowType.Main, false)
          }
          mainWindow.hide()
        }
      } else {
        mainWindow.focus()
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

      const mainWindow = this.mainWindow
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

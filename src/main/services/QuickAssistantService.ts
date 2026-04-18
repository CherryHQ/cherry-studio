/**
 * QuickAssistantService — quick assistant window management
 * (historically referred to as "mini window" in this codebase).
 *
 * Verbatim migration from WindowService: code structure, ordering, platform
 * branches and hacky-fixes are preserved as-is. The "miniWindow" terminology
 * has been unified to "quickWindow" throughout this service (identifiers and
 * comments alike) for service-internal consistency.
 *
 * IPC channels (`IpcChannel.MiniWindow_*`), state file (`miniWindow-state.json`),
 * renderer HTML entry (`miniWindow.html`) and preference keys are cross-process
 * contracts and remain unchanged.
 *
 * TODO: this module is planned to be migrated under WindowManager. At that
 * point, rename the IpcChannel.MiniWindow_* surface uniformly and extract
 * shared default-window-safety helpers.
 */
import { application } from '@application'
import { is } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, screen, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'

import { isSafeExternalUrl } from './security'

const DEFAULT_QUICK_WINDOW_WIDTH = 550
const DEFAULT_QUICK_WINDOW_HEIGHT = 400

const logger = loggerService.withContext('QuickAssistantService')

@Injectable('QuickAssistantService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService'])
export class QuickAssistantService extends BaseService {
  private quickWindow: BrowserWindow | null = null
  private isPinnedQuickWindow: boolean = false
  //hacky-fix: store the focused status of mainWindow before quickWindow shows
  //to restore the focus status when quickWindow hides
  private wasMainWindowFocused: boolean = false

  // Cached mainWindow reference obtained from WindowService.onMainWindowCreated.
  // Only native BrowserWindow APIs are called on it; no WindowService methods are invoked
  // at runtime, keeping the two services independently evolvable.
  private mainWindowRef: BrowserWindow | null = null

  protected async onInit() {
    this.registerIpcHandlers()
    this.subscribeMainWindowLifecycle()
  }

  protected async onReady() {
    // Preload quickWindow independently to resolve a series of issues about quickWindow in Mac.
    // Runs regardless of mainWindow creation timing: the two windows load in parallel.
    const enableQuickAssistant = application.get('PreferenceService').get('feature.quick_assistant.enabled')
    if (enableQuickAssistant && !this.quickWindow) {
      this.quickWindow = this.createQuickWindow(true)
    }
  }

  private registerIpcHandlers() {
    // NOTE: IpcChannel.MiniWindow_* naming is intentionally preserved in this change. The IPC
    //       surface will be re-organized under WindowManager later and renamed uniformly then,
    //       so renaming it now would force disruptive edits across preload + renderer.
    this.ipcHandle(IpcChannel.MiniWindow_Show, () => this.showQuickWindow())
    this.ipcHandle(IpcChannel.MiniWindow_Hide, () => this.hideQuickWindow())
    this.ipcHandle(IpcChannel.MiniWindow_Close, () => this.closeQuickWindow())
    this.ipcHandle(IpcChannel.MiniWindow_Toggle, () => this.toggleQuickWindow())
    this.ipcHandle(IpcChannel.MiniWindow_SetPin, (_, isPinned: boolean) => this.setPinQuickWindow(isPinned))
  }

  /**
   * Subscribe to mainWindow lifecycle through WindowService's event API (loose coupling).
   *   - Hide quickWindow when mainWindow becomes visible ('show') or is restored from
   *     minimized ('restore'). Both are required: WindowService.showMainWindow calls
   *     mainWindow.restore() for the minimized branch, which does NOT fire 'show'.
   *   - Cache the mainWindow reference so isFocused() can be read locally, without
   *     calling WindowService methods at runtime.
   */
  private subscribeMainWindowLifecycle() {
    const windowService = application.get('WindowService')

    const attach = (mainWindow: BrowserWindow) => {
      this.mainWindowRef = mainWindow

      const onMainVisible = () => {
        if (this.quickWindow && !this.quickWindow.isDestroyed()) {
          this.quickWindow.hide()
        }
      }
      const onMainClosed = () => {
        if (this.mainWindowRef === mainWindow) {
          this.mainWindowRef = null
        }
      }

      mainWindow.on('show', onMainVisible)
      mainWindow.on('restore', onMainVisible)
      mainWindow.on('closed', onMainClosed)
      this.registerDisposable(() => {
        mainWindow.removeListener('show', onMainVisible)
        mainWindow.removeListener('restore', onMainVisible)
        mainWindow.removeListener('closed', onMainClosed)
      })
    }

    this.registerDisposable(windowService.onMainWindowCreated((w) => attach(w)))
  }

  // Navigation safety. Trimmed during extraction from WindowService's main-window
  // handlers (WindowService.ts:401-489) — only the pieces that apply to quick remain.
  // TODO: revisit for shared abstraction when migrating to WindowManager.
  private setupQuickWindowWebContents(window: BrowserWindow) {
    window.webContents.on('will-navigate', (event, url) => {
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

    window.webContents.setWindowOpenHandler((details) => {
      if (isSafeExternalUrl(details.url)) {
        void shell.openExternal(details.url)
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${details.url}`)
      }
      return { action: 'deny' }
    })
  }

  public createQuickWindow(isPreload: boolean = false): BrowserWindow {
    if (this.quickWindow && !this.quickWindow.isDestroyed()) {
      return this.quickWindow
    }

    const quickWindowState = windowStateKeeper({
      defaultWidth: DEFAULT_QUICK_WINDOW_WIDTH,
      defaultHeight: DEFAULT_QUICK_WINDOW_HEIGHT,
      file: 'miniWindow-state.json'
    })

    this.quickWindow = new BrowserWindow({
      x: quickWindowState.x,
      y: quickWindowState.y,
      width: quickWindowState.width,
      height: quickWindowState.height,
      minWidth: 350,
      minHeight: 380,
      maxWidth: 1024,
      maxHeight: 768,
      show: false,
      autoHideMenuBar: true,
      transparent: isMac,
      vibrancy: 'under-window',
      visualEffectState: 'followWindow',
      frame: false,
      alwaysOnTop: true,
      useContentSize: true,
      ...(isMac ? { type: 'panel' } : {}),
      skipTaskbar: true,
      resizable: true,
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

    this.setupQuickWindowWebContents(this.quickWindow)

    quickWindowState.manage(this.quickWindow)

    //quickWindow should show in current desktop
    this.quickWindow?.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    //make quickWindow always on top of fullscreen apps with level set
    //[mac] level higher than 'floating' will cover the pinyin input method
    this.quickWindow.setAlwaysOnTop(true, 'floating')

    this.quickWindow.on('ready-to-show', () => {
      if (isPreload) {
        return
      }

      this.wasMainWindowFocused = this.mainWindowRef?.isFocused() || false
      this.quickWindow?.center()
      this.quickWindow?.show()
    })

    this.quickWindow.on('blur', () => {
      if (!this.isPinnedQuickWindow) {
        this.hideQuickWindow()
      }
    })

    this.quickWindow.on('closed', () => {
      this.quickWindow = null
    })

    this.quickWindow.on('hide', () => {
      this.quickWindow?.webContents.send(IpcChannel.HideMiniWindow)
    })

    this.quickWindow.on('show', () => {
      this.quickWindow?.webContents.send(IpcChannel.ShowMiniWindow)
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void this.quickWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/miniWindow.html')
    } else {
      void this.quickWindow.loadFile(join(__dirname, '../renderer/miniWindow.html'))
    }

    return this.quickWindow
  }

  public showQuickWindow() {
    const enableQuickAssistant = application.get('PreferenceService').get('feature.quick_assistant.enabled')

    if (!enableQuickAssistant) {
      return
    }

    if (this.quickWindow && !this.quickWindow.isDestroyed()) {
      this.wasMainWindowFocused = this.mainWindowRef?.isFocused() || false

      // [Windows] hacky fix
      // the window is minimized only when in Windows platform
      // because it's a workaround for Windows, see `hideQuickWindow()`
      if (this.quickWindow?.isMinimized()) {
        // don't let the window being seen before we finish adjusting the position across screens
        this.quickWindow?.setOpacity(0)
        // DO NOT use `restore()` here, Electron has the bug with screens of different scale factor
        // We have to use `show()` here, then set the position and bounds
        this.quickWindow?.show()
      }

      const quickWindowBounds = this.quickWindow.getBounds()

      // Check if quickWindow is on the same screen as mouse cursor
      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const quickWindowDisplay = screen.getDisplayNearestPoint(quickWindowBounds)

      // Show the quickWindow on the cursor's screen center
      // If quickWindow is not on the same screen as cursor, move it to cursor's screen center
      if (cursorDisplay.id !== quickWindowDisplay.id) {
        const workArea = cursorDisplay.bounds

        // use current window size to avoid the bug of Electron with screens of different scale factor
        const currentBounds = this.quickWindow.getBounds()
        const quickWindowWidth = currentBounds.width
        const quickWindowHeight = currentBounds.height

        // move to the center of the cursor's screen
        const quickWindowX = Math.round(workArea.x + (workArea.width - quickWindowWidth) / 2)
        const quickWindowY = Math.round(workArea.y + (workArea.height - quickWindowHeight) / 2)

        this.quickWindow.setPosition(quickWindowX, quickWindowY, false)
        this.quickWindow.setBounds({
          x: quickWindowX,
          y: quickWindowY,
          width: quickWindowWidth,
          height: quickWindowHeight
        })
      }

      this.quickWindow?.setOpacity(1)
      this.quickWindow?.show()

      return
    }

    if (!this.quickWindow || this.quickWindow.isDestroyed()) {
      this.quickWindow = this.createQuickWindow()
    }

    this.quickWindow.show()
  }

  public hideQuickWindow() {
    if (!this.quickWindow || this.quickWindow.isDestroyed()) {
      return
    }

    //[macOs/Windows] hacky fix
    // previous window(not self-app) should be focused again after quickWindow hide
    // this workaround is to make previous window focused again after quickWindow hide
    if (isWin) {
      this.quickWindow.setOpacity(0) // don't show the minimizing animation
      this.quickWindow.minimize()
      return
    } else if (isMac) {
      this.quickWindow.hide()
      const majorVersion = parseInt(process.getSystemVersion().split('.')[0], 10)
      if (majorVersion >= 26) {
        // on macOS 26+, the popup of the quickWindow would not change the focus to previous application.
        return
      }
      if (!this.wasMainWindowFocused) {
        app.hide()
      }
      return
    }

    this.quickWindow.hide()
  }

  public closeQuickWindow() {
    this.quickWindow?.close()
  }

  public toggleQuickWindow() {
    if (this.quickWindow && !this.quickWindow.isDestroyed() && this.quickWindow.isVisible()) {
      this.hideQuickWindow()
      return
    }

    this.showQuickWindow()
  }

  public setPinQuickWindow(isPinned: boolean) {
    this.isPinnedQuickWindow = isPinned
  }
}

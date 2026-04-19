/**
 * QuickAssistantService — business orchestration for the quick assistant window.
 *
 * Window infrastructure (BrowserWindow construction options, preload, HTML entry,
 * Dock visibility, macOS alwaysOnTop reapply) is owned by WindowManager via the
 * `WindowType.QuickAssistant` registry entry. This service keeps the per-feature
 * business policy:
 *
 *   - feature flag gate (`feature.quick_assistant.enabled`)
 *   - pin / blur auto-hide
 *   - cursor-aware repositioning across displays
 *   - platform-specific hide branch (Windows minimize+opacity, macOS app.hide)
 *   - mainWindow lifecycle coupling (auto-hide when main window appears)
 *   - strict navigation safety (block any non-localhost navigation)
 *   - bounds persistence via electron-window-state
 *
 * Notes for future maintainers:
 *   - `mainWindowRef` caches the BrowserWindow directly because WindowService is
 *     not yet under WindowManager. Once it is, replace the cache with
 *     `wm.getWindowsByType(WindowType.Main)[0]`.
 *   - `wasMainWindowFocused` is captured exactly once per show, inside
 *     `showQuickAssistant`. The original service captured it both there and in
 *     `ready-to-show`, but with `show: false` in the registry every user-visible
 *     show now flows through `showQuickAssistant`, so a single capture point suffices.
 */
import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, screen, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'

import { isSafeExternalUrl } from './security'

const DEFAULT_QUICK_ASSISTANT_WIDTH = 550
const DEFAULT_QUICK_ASSISTANT_HEIGHT = 400
const QUICK_ASSISTANT_STATE_FILE = 'quickAssistant-state.json'
/**
 * On macOS 26+ (Tahoe / future), hiding a panel-style window keeps the previous
 * application as the frontmost without the manual `app.hide()` workaround the
 * older releases need to restore the prior app's focus.
 */
const MACOS_AUTO_FOCUS_VERSION = 26

const logger = loggerService.withContext('QuickAssistantService')

@Injectable('QuickAssistantService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService', 'WindowManager'])
export class QuickAssistantService extends BaseService implements Activatable {
  private windowId: string | null = null
  private isPinnedQuickAssistant = false
  // Captured before each show; hideQuickAssistant consults it to decide whether to call app.hide()
  // so that the previous foreground app gets focus back instead of an unrelated app.
  private wasMainWindowFocused = false
  // Cached mainWindow reference — see file-level docstring for why this asymmetry exists.
  private mainWindowRef: BrowserWindow | null = null
  // Instantiated in onActivate BEFORE the BrowserWindow is created so its persisted
  // x/y/width/height can be passed as constructor options. Calling `manage()` on it later
  // (inside setupQuickAssistant) only attaches resize/move/close listeners — it does NOT
  // retroactively apply persisted bounds, hence the up-front instantiation. Reset to null
  // on deactivate so the next activation reloads the most recent bounds from disk.
  private quickAssistantState: ReturnType<typeof windowStateKeeper> | null = null

  protected async onInit() {
    this.registerIpcHandlers()
    this.subscribeMainWindowLifecycle()

    // Attach per-instance behavior to each fresh QuickAssistant window. Fires exactly
    // once per BrowserWindow creation (never on singleton reopen) — pairs with
    // wm.open() in createQuickAssistant() so the setup covers both the primary path
    // and any future re-creation path uniformly.
    const wm = application.get('WindowManager')
    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.QuickAssistant, ({ window }) => {
        this.setupQuickAssistant(window)
      })
    )

    // Preference toggle drives activate/deactivate of heavy resources (BrowserWindow).
    // IPC handlers remain registered regardless, so the settings panel switch and global
    // shortcut continue to function; they simply become no-ops while deactivated.
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable({
      dispose: preferenceService.subscribeChange('feature.quick_assistant.enabled', (enabled: boolean) => {
        if (enabled) void this.activate()
        else void this.deactivate()
      })
    })
  }

  protected async onReady() {
    const preferenceService = application.get('PreferenceService')
    if (preferenceService.get('feature.quick_assistant.enabled')) {
      await this.activate()
    }
  }

  /**
   * Load heavy resources: the BrowserWindow and its bounds-tracking state. If creation
   * fails partway, releaseActivationResources() cleans up so the next activate() starts
   * from a clean slate (Activatable failure contract).
   *
   * Focus-steal workaround (macOS only): constructing a `type: 'panel'` BrowserWindow
   * with `alwaysOnTop: true` briefly pulls the new NSPanel to the front even though
   * `show: false` is set, causing the previously focused window (e.g. the main window
   * from which the user just flipped the preference switch) to lose focus. We capture
   * whichever BrowserWindow was focused before creation and restore focus afterwards.
   */
  async onActivate(): Promise<void> {
    const focusedBefore = isMac ? BrowserWindow.getFocusedWindow() : null
    try {
      this.createQuickAssistant()
    } catch (error) {
      this.releaseActivationResources()
      throw error
    }
    if (focusedBefore && !focusedBefore.isDestroyed() && focusedBefore.id !== this.getQuickAssistant()?.id) {
      focusedBefore.focus()
    }
  }

  /**
   * Release heavy resources: destroy the BrowserWindow (ending its Chromium renderer
   * process) and drop the windowStateKeeper reference. Also invoked automatically by
   * BaseService._doStop() on service shutdown.
   */
  async onDeactivate(): Promise<void> {
    this.releaseActivationResources()
  }

  private releaseActivationResources(): void {
    if (this.windowId) {
      // QuickAssistant is a singleton — wm.close() falls through to destroyWindow()
      // just like wm.destroy() would, but stays in the Consumer API layer. The
      // registered 'closed' listener clears this.windowId via onClosed in setupQuickAssistant.
      const wm = application.get('WindowManager')
      wm.close(this.windowId)
      this.windowId = null
    }
    // electron-window-state writes are debounced via resize/move/close listeners that
    // fire naturally on destroy — no manual flush needed. Drop the reference so the
    // next activate() instantiates a fresh keeper that reloads persisted bounds.
    this.quickAssistantState = null
    this.isPinnedQuickAssistant = false
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.QuickAssistant_Show, () => this.showQuickAssistant())
    this.ipcHandle(IpcChannel.QuickAssistant_Hide, () => this.hideQuickAssistant())
    this.ipcHandle(IpcChannel.QuickAssistant_Close, () => this.closeQuickAssistant())
    this.ipcHandle(IpcChannel.QuickAssistant_Toggle, () => this.toggleQuickAssistant())
    this.ipcHandle(IpcChannel.QuickAssistant_SetPin, (_, isPinned: boolean) => this.setPinQuickAssistant(isPinned))
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
        const window = this.getQuickAssistant()
        if (window) window.hide()
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

  /**
   * Strict navigation safety for the quick window. Quick window is a single-page SPA;
   * any will-navigate that is not the dev-server URL is treated as an attempt to leave
   * the SPA shell and is either re-routed to the system browser (when safe) or denied.
   *
   * Coexists with WindowManager's default handlers (WindowManager.ts: createWindow):
   *   - will-navigate: both listeners fire; this stricter preventDefault wins.
   *   - setWindowOpenHandler: last-call-wins per Electron contract; this overrides
   *     WindowManager's default and applies the stricter safe-URL check.
   */
  private setupQuickAssistantWebContents(window: BrowserWindow) {
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

  /**
   * Idempotently ensure the quick window exists. Safe to call from any code path —
   * if the window is already alive (this.windowId set), this is a no-op.
   *
   * The windowStateKeeper is instantiated BEFORE wm.open() so its persisted
   * x/y/w/h can be passed as constructor options. `state.manage()` (invoked in
   * setupQuickAssistant, which runs inside the onWindowCreatedByType subscription)
   * only attaches outbound listeners — it does NOT retroactively apply persisted
   * bounds, hence the up-front instantiation.
   *
   * wm.open() fires _onWindowCreated synchronously during createWindow(), so by
   * the time it returns both the BrowserWindow and our setup listeners (blur,
   * closed, show) are attached. We then assign this.windowId and proceed.
   */
  private createQuickAssistant() {
    if (this.windowId) return

    if (!this.quickAssistantState) {
      this.quickAssistantState = windowStateKeeper({
        defaultWidth: DEFAULT_QUICK_ASSISTANT_WIDTH,
        defaultHeight: DEFAULT_QUICK_ASSISTANT_HEIGHT,
        file: QUICK_ASSISTANT_STATE_FILE
      })
    }

    const wm = application.get('WindowManager')
    this.windowId = wm.open(WindowType.QuickAssistant, {
      options: {
        x: this.quickAssistantState.x,
        y: this.quickAssistantState.y,
        width: this.quickAssistantState.width,
        height: this.quickAssistantState.height
      }
    })
  }

  /**
   * Attach all quick-window-specific behavior to a freshly created BrowserWindow:
   * navigation safety, bounds persistence, OS workspace visibility, alwaysOnTop level,
   * blur/show listeners. Invoked once per fresh window from the onWindowCreatedByType
   * subscription registered in onInit.
   */
  private setupQuickAssistant(window: BrowserWindow) {
    this.setupQuickAssistantWebContents(window)

    // Outbound bounds persistence: resize/move/close listeners that write to disk.
    // Inbound restoration was already done at construction via wm.create options.
    this.quickAssistantState?.manage(window)

    // Keep the window visible across all workspaces and over fullscreen apps.
    // (Reusable WindowQuirks abstraction is a planned follow-up — see plan doc.)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Set the initial alwaysOnTop level once. The macReapplyAlwaysOnTop quirk
    // ensures macOS does not silently demote the level on subsequent show() calls.
    window.setAlwaysOnTop(true, 'floating')

    const onBlur = () => {
      if (!this.isPinnedQuickAssistant) {
        this.hideQuickAssistant()
      }
    }
    // Renderer-facing event: HomeWindow listens to this and re-reads clipboard
    // + focuses input on every show. The symmetric "Hidden" event used to exist
    // but had no listener anywhere — removed as dead code.
    const onShow = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannel.QuickAssistant_Shown)
      }
    }

    window.on('blur', onBlur)
    window.on('show', onShow)
    this.registerDisposable(() => {
      if (window.isDestroyed()) return
      window.removeListener('blur', onBlur)
      window.removeListener('show', onShow)
    })
  }

  /** Returns the live quick window or null if not created / already destroyed. */
  private getQuickAssistant(): BrowserWindow | null {
    if (!this.windowId) return null
    const window = application.get('WindowManager').getWindow(this.windowId)
    if (!window || window.isDestroyed()) return null
    return window
  }

  public showQuickAssistant() {
    // Activation state is the single source of truth: when the feature preference is
    // enabled, the service is activated and the window exists; when disabled, we simply
    // bail. The preference subscription in onInit keeps these in lockstep.
    if (!this.isActivated) return

    const window = this.getQuickAssistant()
    if (!window) return

    this.proceedShow()
  }

  /** Inner show pipeline. Assumes the quick window exists and its content is ready. */
  private proceedShow() {
    const window = this.getQuickAssistant()
    if (!window) return

    this.wasMainWindowFocused = this.mainWindowRef?.isFocused() ?? false

    // [Windows] Recovery from the minimize-instead-of-hide branch in hideQuickAssistant.
    // Note: do NOT use restore() — Electron has a bug across screens with different scale
    // factors. Use show() then setPosition/setBounds. setOpacity(0) hides the visual
    // glitch while we reposition.
    if (window.isMinimized()) {
      window.setOpacity(0)
      window.show()
    }

    this.repositionToCursorDisplay(window)

    window.setOpacity(1)
    window.show()
  }

  /**
   * If the cursor is on a different display than the quick window, move the window
   * to the center of the cursor's display. setPosition + setBounds works around an
   * Electron scale-factor bug between displays.
   */
  private repositionToCursorDisplay(window: BrowserWindow) {
    const bounds = window.getBounds()
    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const windowDisplay = screen.getDisplayNearestPoint(bounds)

    if (cursorDisplay.id === windowDisplay.id) return

    const workArea = cursorDisplay.bounds
    const { width, height } = bounds
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + (workArea.height - height) / 2)

    window.setPosition(x, y, false)
    window.setBounds({ x, y, width, height })
  }

  public hideQuickAssistant() {
    const window = this.getQuickAssistant()
    if (!window) return

    if (isWin) {
      // Hide() vs minimize() on Windows: minimize avoids a visible flicker on next show
      // and skipTaskbar:true keeps it out of the taskbar. setOpacity(0) hides the
      // minimize animation entirely.
      window.setOpacity(0)
      window.minimize()
      return
    }

    if (isMac) {
      window.hide()
      const majorVersion = parseInt(process.getSystemVersion().split('.')[0], 10)
      if (majorVersion >= MACOS_AUTO_FOCUS_VERSION) {
        // macOS 26+ already returns focus to the previous foreground app on hide.
        return
      }
      // On older macOS, hide() leaves us as the frontmost app; app.hide() returns
      // focus to whatever was focused before the quick window — but only if THAT
      // window was not our own mainWindow (else we hide the whole app needlessly).
      if (!this.wasMainWindowFocused) {
        app.hide()
      }
      return
    }

    window.hide()
  }

  /**
   * Behavior change vs. legacy: this is now a hide(), not a destroy. The quick window
   * is a high-frequency toggle surface; destroy + recreate would cause a blank-flash
   * on next show (loadURL is async and ready-to-show races the show() call) and waste
   * the preload work. The two renderer call sites (settings panel toggles) only need
   * the window to disappear — hide() satisfies that. True teardown happens in
   * onDeactivate() when the feature preference is turned off, and as a final fallback
   * in WindowManager.onDestroy() at app quit.
   */
  public closeQuickAssistant() {
    this.getQuickAssistant()?.hide()
  }

  public toggleQuickAssistant() {
    const window = this.getQuickAssistant()
    if (window?.isVisible()) {
      this.hideQuickAssistant()
      return
    }
    this.showQuickAssistant()
  }

  public setPinQuickAssistant(isPinned: boolean) {
    this.isPinnedQuickAssistant = isPinned
  }
}

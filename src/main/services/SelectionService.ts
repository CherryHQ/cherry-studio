import { application } from '@application'
import { loggerService } from '@logger'
import { SELECTION_FINETUNED_LIST, SELECTION_PREDEFINED_BLACKLIST } from '@main/configs/SelectionConfig'
import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, clipboard, screen, systemPreferences } from 'electron'
import type {
  KeyboardEventData,
  MouseEventData,
  SelectionHookConstructor,
  SelectionHookInstance,
  TextSelectionData
} from 'selection-hook'

const logger = loggerService.withContext('SelectionService')

let SelectionHook: SelectionHookConstructor | null = null

// Type definitions
type Point = { x: number; y: number }
type RelativeOrientation =
  | 'topLeft'
  | 'topRight'
  | 'topMiddle'
  | 'bottomLeft'
  | 'bottomRight'
  | 'bottomMiddle'
  | 'middleLeft'
  | 'middleRight'
  | 'center'

/** SelectionService manages the selection hook and the toolbar window
 *
 * Features:
 * - Text selection detection and processing
 * - Floating toolbar management
 * - Action window handling
 * - Multiple trigger modes (selection/alt-key)
 * - Screen boundary-aware positioning
 *
 * Usage:
 *   const selectionService = application.get('SelectionService')
 */
@Injectable('SelectionService')
@ServicePhase(Phase.WhenReady)
export class SelectionService extends BaseService implements Activatable {
  private selectionHook: SelectionHookInstance | null = null

  private initStatus: boolean = false

  private triggerMode = SelectionTriggerMode.Selected
  private isFollowToolbar = true
  private isRemeberWinSize = false
  private filterMode = 'default'
  private filterList: string[] = []

  private unsubscriberForChangeListeners: (() => void)[] = []

  // Toolbar window is managed by WindowManager (singleton). We cache the BrowserWindow
  // reference here because there are ~20 usage sites across this file — the cache avoids
  // querying WindowManager at each call site. Kept in sync via onWindowCreated/Destroyed.
  private toolbarWindow: BrowserWindow | null = null
  private toolbarWindowId: string | null = null

  private isHideByMouseKeyListenerActive: boolean = false
  private isCtrlkeyListenerActive: boolean = false
  /**
   * Ctrlkey action states:
   * 0 - Ready to monitor ctrlkey action
   * >0 - Currently monitoring ctrlkey action
   * -1 - Ctrlkey action triggered, no need to process again
   */
  private lastCtrlkeyDownTime: number = 0

  //Linux wayland specific
  //isLinuxWaylandDisplay: true when running under Wayland
  //isLinuxXWaylandMode: true when running under XWayland
  //hasLinuxInputDeviceAccess: true when the process has access to input devices
  //isLinuxCompositorCompatible: true when the compositor supports data-control protocols
  private isLinuxWaylandDisplay: boolean = false
  private isLinuxXWaylandMode: boolean = false
  private hasLinuxInputDeviceAccess: boolean = false
  private isLinuxCompositorCompatible: boolean = false

  private zoomFactor: number = 1

  private TOOLBAR_WIDTH = 350
  private TOOLBAR_HEIGHT = 43

  private readonly ACTION_WINDOW_WIDTH = 500
  private readonly ACTION_WINDOW_HEIGHT = 400

  private lastActionWindowSize: { width: number; height: number } = {
    width: this.ACTION_WINDOW_WIDTH,
    height: this.ACTION_WINDOW_HEIGHT
  }

  private loadModuleAndCreateInstance(): boolean {
    try {
      if (!SelectionHook) {
        SelectionHook = require('selection-hook')
      }

      if (!SelectionHook) {
        this.logError('Failed to load selection-hook module')
        return false
      }

      this.selectionHook = new SelectionHook()
      if (!this.selectionHook) {
        this.logError('Failed to create SelectionHook instance')
        return false
      }

      // Detect Wayland display protocol for platform-specific behavior.
      // On Wayland, Electron runs via XWayland, causing coordinate space mismatches
      // between selection-hook (Wayland compositor coords) and Electron (XWayland coords).
      // Several workarounds are applied when isWaylandDisplay is true.
      if (isLinux) {
        const envInfo = this.selectionHook.linuxGetEnvInfo()
        this.isLinuxWaylandDisplay = envInfo?.displayProtocol === SelectionHook.DisplayProtocol.WAYLAND
        this.hasLinuxInputDeviceAccess = envInfo?.hasInputDeviceAccess ?? false

        // X11: all compositors are compatible (no data-control protocol needed).
        // Wayland: Mutter (GNOME) does not implement data-control protocols; Unknown is uncertain.
        if (this.isLinuxWaylandDisplay) {
          this.isLinuxCompositorCompatible =
            envInfo?.compositorType !== SelectionHook.CompositorType.MUTTER &&
            envInfo?.compositorType !== SelectionHook.CompositorType.UNKNOWN
        } else {
          this.isLinuxCompositorCompatible = true
        }

        // Detect if Electron is running under XWayland (not native Wayland).
        // Since Electron 38+, native Wayland is the default when XDG_SESSION_TYPE=wayland.
        // When --ozone-platform=x11 is set, Electron runs via XWayland instead.
        if (this.isLinuxWaylandDisplay) {
          this.isLinuxXWaylandMode = app.commandLine.getSwitchValue('ozone-platform').toLowerCase() === 'x11'
        }
      }

      this.initStatus = true
      this.logInfo('selection-hook module loaded and instance created successfully')
      return true
    } catch (error) {
      this.logError('Failed to load selection-hook:', error as Error)
      return false
    }
  }

  onActivate(): void {
    // Load native module if not yet loaded (lazy loading preserved across activation cycles)
    if (!this.initStatus) {
      if (!this.loadModuleAndCreateInstance()) {
        // Setting preference to false triggers the subscription which calls deactivate(),
        // but _activating guard in BaseService ensures the deactivate() is a safe no-op.
        const preferenceService = application.get('PreferenceService')
        void preferenceService.set('feature.selection.enabled', false)
        throw new Error('Failed to load selection-hook module')
      }
    }

    if (isMac) {
      if (!systemPreferences.isTrustedAccessibilityClient(false)) {
        this.logError('process is not trusted on macOS, please turn on the Accessibility permission')
        throw new Error('macOS accessibility permission not granted')
      }
    }

    try {
      const wm = application.get('WindowManager')

      // Resume the action pool in case a prior deactivate/activate cycle suspended it.
      // With registry warmup: 'eager', the pool auto-creates idle windows at app start,
      // so the first user-triggered action recycles instantly instead of going through
      // the fresh-path (create + load HTML + wait for React to mount).
      wm.resumePool(WindowType.SelectionAction)

      // Open the toolbar (singleton) — registry's show: false ensures no auto-show here,
      // showToolbarAtPosition controls positioning and visibility.
      this.toolbarWindowId = wm.open(WindowType.SelectionToolbar)

      this.selectionHook!.on('error', (error: { message: string }) => {
        this.logError('Error in SelectionHook:', error as Error)
      })
      this.selectionHook!.on('text-selection', this.processTextSelection)

      if (!this.selectionHook!.start({ debug: isDev })) {
        throw new Error('Failed to start text selection hook')
      }

      this.initConfig()
      this.processTriggerMode()
      this.logInfo('SelectionService activated', true)
    } catch (error) {
      // Clean up partial state before throwing (Activatable failure contract)
      this.releaseActivationResources()
      throw error
    }
  }

  onDeactivate(): void {
    this.releaseActivationResources()
    this.logInfo('SelectionService deactivated', true)
  }

  protected async onInit(): Promise<void> {
    this.initZoomFactor()
    this.registerIpcHandlers()

    const wm = application.get('WindowManager')

    // Inject behavior into newly-created Selection windows. onWindowCreatedByType fires
    // synchronously before content loads, so listeners here attach before the renderer
    // can start sending IPC messages.
    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.SelectionToolbar, ({ window }) => {
        // Cache the BrowserWindow reference for the ~20 downstream call sites
        // (showToolbarAtPosition, hideToolbar, processTextSelection, etc.)
        this.toolbarWindow = window
        this.setupToolbarBehavior(window)
      })
    )

    // Per-instance resized listener for action windows. Must live inside
    // onWindowCreatedByType — pool recycle paths do not re-fire the event,
    // so attaching at the open() call site would either miss recycled instances
    // or accumulate duplicates across reuses.
    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.SelectionAction, (mw) => {
        mw.window.on('resized', () => {
          if (mw.window.isDestroyed()) return
          if (this.isRemeberWinSize) {
            this.lastActionWindowSize = {
              width: mw.window.getBounds().width,
              height: mw.window.getBounds().height
            }
          }
        })
      })
    )

    // Destruction: keep the cached toolbar reference in sync.
    // The macOS focus dance on hide/close is handled by the macRestoreFocusOnHide quirk
    // (see WindowManager.applyQuirks) — no subscription needed here.
    this.registerDisposable(
      wm.onWindowDestroyedByType(WindowType.SelectionToolbar, ({ id }) => {
        if (id === this.toolbarWindowId) {
          this.toolbarWindow = null
          this.toolbarWindowId = null
        }
      })
    )

    const preferenceService = application.get('PreferenceService')
    this.registerDisposable({
      dispose: preferenceService.subscribeChange('feature.selection.enabled', (enabled: boolean) => {
        if (enabled) void this.activate()
        else void this.deactivate()
      })
    })
  }

  protected async onReady(): Promise<void> {
    const preferenceService = application.get('PreferenceService')
    if (preferenceService.get('feature.selection.enabled')) {
      this.logInfo('Selection feature enabled, loading selection-hook module')
      await this.activate()
    } else {
      this.logInfo('Selection feature disabled, skipping selection-hook module loading')
    }
  }

  protected async onStop(): Promise<void> {
    // _doStop() auto-deactivates before onStop() — releaseActivationResources() already called
    // Disposables (preference subscriptions) are cleaned up after onStop() by the framework

    // Final cleanup: release the native module entirely
    if (this.selectionHook) {
      this.selectionHook.cleanup()
    }
    this.selectionHook = null
    this.initStatus = false
    this.logInfo('SelectionService stopped via lifecycle', true)
  }

  public isInitialized(): boolean {
    return this.initStatus
  }

  public getSelectionHook(): SelectionHookInstance | null {
    return this.selectionHook
  }

  public getLinuxEnvInfo(): {
    isLinuxWaylandDisplay: boolean
    isLinuxXWaylandMode: boolean
    hasLinuxInputDeviceAccess: boolean
    isLinuxCompositorCompatible: boolean
  } {
    return {
      isLinuxWaylandDisplay: this.isLinuxWaylandDisplay,
      isLinuxXWaylandMode: this.isLinuxXWaylandMode,
      hasLinuxInputDeviceAccess: this.hasLinuxInputDeviceAccess,
      isLinuxCompositorCompatible: this.isLinuxCompositorCompatible
    }
  }

  private initZoomFactor(): void {
    const preferenceService = application.get('PreferenceService')
    const zoomFactor = preferenceService.get('app.zoom_factor')

    if (zoomFactor) {
      this.setZoomFactor(zoomFactor)
    }

    this.registerDisposable({
      dispose: preferenceService.subscribeChange('app.zoom_factor', (zoomFactor: number) => {
        this.setZoomFactor(zoomFactor)
      })
    })
  }

  public setZoomFactor = (zoomFactor: number) => {
    this.zoomFactor = zoomFactor
  }

  private initConfig(): void {
    const preferenceService = application.get('PreferenceService')
    this.triggerMode = preferenceService.get('feature.selection.trigger_mode')
    this.isFollowToolbar = preferenceService.get('feature.selection.follow_toolbar')
    this.isRemeberWinSize = preferenceService.get('feature.selection.remember_win_size')
    this.filterMode = preferenceService.get('feature.selection.filter_mode')
    this.filterList = preferenceService.get('feature.selection.filter_list')

    this.setHookGlobalFilterMode(this.filterMode, this.filterList)
    this.setHookFineTunedList()

    this.unsubscriberForChangeListeners.push(
      preferenceService.subscribeChange('feature.selection.trigger_mode', (triggerMode: SelectionTriggerMode) => {
        const oldTriggerMode = this.triggerMode

        this.triggerMode = triggerMode
        this.processTriggerMode()

        //trigger mode changed, need to update the filter list
        if (oldTriggerMode !== triggerMode) {
          this.setHookGlobalFilterMode(this.filterMode, this.filterList)
        }
      })
    )
    this.unsubscriberForChangeListeners.push(
      preferenceService.subscribeChange('feature.selection.follow_toolbar', (followToolbar: boolean) => {
        this.isFollowToolbar = followToolbar
      })
    )
    this.unsubscriberForChangeListeners.push(
      preferenceService.subscribeChange('feature.selection.remember_win_size', (rememberWinSize: boolean) => {
        this.isRemeberWinSize = rememberWinSize
        //when off, reset the last action window size to default
        if (!this.isRemeberWinSize) {
          this.lastActionWindowSize = {
            width: this.ACTION_WINDOW_WIDTH,
            height: this.ACTION_WINDOW_HEIGHT
          }
        }
      })
    )
    this.unsubscriberForChangeListeners.push(
      preferenceService.subscribeChange('feature.selection.filter_mode', (filterMode: string) => {
        this.filterMode = filterMode
        this.setHookGlobalFilterMode(this.filterMode, this.filterList)
      })
    )
    this.unsubscriberForChangeListeners.push(
      preferenceService.subscribeChange('feature.selection.filter_list', (filterList: string[]) => {
        this.filterList = filterList
        this.setHookGlobalFilterMode(this.filterMode, this.filterList)
      })
    )
  }

  /**
   * Set the global filter mode for the selection-hook
   * @param mode - The mode to set, either 'default', 'whitelist', or 'blacklist'
   * @param list - An array of strings representing the list of items to include or exclude
   */
  private setHookGlobalFilterMode(mode: string, list: string[]): void {
    if (!this.selectionHook) return

    const modeMap = {
      default: SelectionHook!.FilterMode.DEFAULT,
      whitelist: SelectionHook!.FilterMode.INCLUDE_LIST,
      blacklist: SelectionHook!.FilterMode.EXCLUDE_LIST
    }

    const predefinedBlacklist = isWin ? SELECTION_PREDEFINED_BLACKLIST.WINDOWS : SELECTION_PREDEFINED_BLACKLIST.MAC

    let combinedList: string[] = list
    let combinedMode = mode

    //only the selected mode need to combine the predefined blacklist with the user-defined blacklist
    if (this.triggerMode === SelectionTriggerMode.Selected) {
      switch (mode) {
        case 'blacklist':
          //combine the predefined blacklist with the user-defined blacklist
          combinedList = [...new Set([...list, ...predefinedBlacklist])]
          break
        case 'whitelist':
          combinedList = [...list]
          break
        case 'default':
        default:
          //use the predefined blacklist as the default filter list
          combinedList = [...predefinedBlacklist]
          combinedMode = 'blacklist'
          break
      }
    }

    if (!this.selectionHook.setGlobalFilterMode(modeMap[combinedMode], combinedList)) {
      this.logError('Failed to set selection-hook global filter mode')
    }
  }

  private setHookFineTunedList(): void {
    if (!this.selectionHook) return

    const excludeClipboardCursorDetectList = isWin
      ? SELECTION_FINETUNED_LIST.EXCLUDE_CLIPBOARD_CURSOR_DETECT.WINDOWS
      : SELECTION_FINETUNED_LIST.EXCLUDE_CLIPBOARD_CURSOR_DETECT.MAC
    const includeClipboardDelayReadList = isWin
      ? SELECTION_FINETUNED_LIST.INCLUDE_CLIPBOARD_DELAY_READ.WINDOWS
      : SELECTION_FINETUNED_LIST.INCLUDE_CLIPBOARD_DELAY_READ.MAC

    this.selectionHook.setFineTunedList(
      SelectionHook!.FineTunedListType.EXCLUDE_CLIPBOARD_CURSOR_DETECT,
      excludeClipboardCursorDetectList
    )

    this.selectionHook.setFineTunedList(
      SelectionHook!.FineTunedListType.INCLUDE_CLIPBOARD_DELAY_READ,
      includeClipboardDelayReadList
    )
  }

  /**
   * Toggle the enabled state of the selection service
   * Will sync the new enabled store to all renderer windows
   */
  public toggleEnabled(enabled: boolean | undefined = undefined): void {
    const preferenceService = application.get('PreferenceService')
    const newEnabled = enabled === undefined ? !preferenceService.get('feature.selection.enabled') : enabled

    void preferenceService.set('feature.selection.enabled', newEnabled)
  }

  /**
   * Attach toolbar-specific runtime behavior to a freshly-created SelectionToolbar window.
   * Invoked from the WindowManager.onWindowCreated hook registered in onInit().
   *
   * Window configuration (frame, transparent, type: 'panel', focusable default, etc.) lives
   * in windowRegistry.ts alongside the full platform-specific commentary. This method only
   * handles behavior that depends on runtime state (e.g., Wayland detection) or event wiring.
   */
  private setupToolbarBehavior(window: BrowserWindow): void {
    // [Linux Wayland] focusable must be true on Wayland to receive blur events for
    // outside-click hiding. onWindowCreated fires before loadURL(), so setFocusable()
    // here takes effect before the window is shown. The full platform rationale is
    // documented in windowRegistry.ts under SelectionToolbar's windowOptions.
    if (isLinux) {
      window.setFocusable(this.isLinuxWaylandDisplay)
    }

    // Blur → hide is now driven declaratively by WindowManager via
    // `behavior.hideOnBlur: true` (see windowRegistry.ts). The previous
    // handler here called `hideToolbar()`, which combined `window.hide()`
    // with the mouse-key hook cleanup; the hook lifecycle is now bound to
    // the window's show/hide events below, so a plain `window.hide()` from
    // WM suffices and all cleanup still runs.

    window.on('show', () => {
      window.webContents.send(IpcChannel.Selection_ToolbarVisibilityChange, true)
      // Mouse-key hook start tied to visibility rather than to specific call
      // sites: normal show path, crash-recovery re-open, and any future
      // caller all inherit this for free.
      this.startHideByMouseKeyListener()
    })

    window.on('hide', () => {
      window.webContents.send(IpcChannel.Selection_ToolbarVisibilityChange, false)
      // Symmetric to the show listener — any path to hidden (business
      // `hideToolbar()`, WM blur-driven `window.hide()`, quirk-wrapped hide)
      // triggers cleanup. `stopHideByMouseKeyListener` is idempotent.
      this.stopHideByMouseKeyListener()
    })

    /** uncomment to open dev tools in dev mode */
    // if (isDev) {
    //   window.once('ready-to-show', () => {
    //     window.webContents.openDevTools({ mode: 'detach' })
    //   })
    // }

    // Note: there is no 'closed' listener here — WindowManager fires onWindowDestroyed
    // which is handled in onInit() to clear toolbarWindowId/toolbarWindow.
  }

  /**
   * Show toolbar at specified position with given orientation
   * @param point Reference point for positioning, logical coordinates
   * @param orientation Preferred position relative to reference point
   */
  private showToolbarAtPosition(point: Point, orientation: RelativeOrientation, programName: string): void {
    if (!this.isToolbarAlive()) {
      // Toolbar was destroyed (e.g., crash recovery). Re-open via WindowManager — the
      // onWindowCreated handler will call setupToolbarBehavior() and update toolbarWindow.
      // After ready-to-show, retry positioning. If the caller is in a tight loop, the
      // recursive retry will converge as soon as the renderer finishes loading.
      const wm = application.get('WindowManager')
      this.toolbarWindowId = wm.open(WindowType.SelectionToolbar)
      const newToolbar = wm.getWindow(this.toolbarWindowId)
      if (newToolbar) {
        newToolbar.once('ready-to-show', () => {
          this.showToolbarAtPosition(point, orientation, programName)
        })
      }
      return
    }

    const { x: posX, y: posY } = this.calculateToolbarPosition(point, orientation)

    const { toolbarWidth, toolbarHeight } = this.getToolbarRealSize()
    this.toolbarWindow!.setPosition(posX, posY, false)
    // Prevent window resize
    this.toolbarWindow!.setBounds({
      width: toolbarWidth,
      height: toolbarHeight,
      x: posX,
      y: posY
    })

    // setAlwaysOnTop(true, 'screen-saver') is re-applied by the macReapplyAlwaysOnTop
    // quirk after every show()/showInactive() call (see WindowManager.applyQuirks).

    if (!isMac) {
      this.toolbarWindow!.show()
      /**
       * [Windows]
       *   In Windows 10, setOpacity(1) will make the window completely transparent
       *   It's a strange behavior, so we don't use it for compatibility
       */
      // this.toolbarWindow!.setOpacity(1)
      // Mouse-key hook start fires from window.on('show') in setupToolbarBehavior.
      return
    }

    /************************************************
     * [macOS] the following code is only for macOS
     *
     * WARNING:
     *   DO NOT MODIFY THESE CODES, UNLESS YOU REALLY KNOW WHAT YOU ARE DOING!!!!
     *************************************************/

    // [macOS] a hacky way
    // when set `skipTransformProcessType: true`, if the selection is in self app, it will make the selection canceled after toolbar showing
    // so we just don't set `skipTransformProcessType: true` when in self app
    const isSelf = ['com.github.Electron', 'com.kangfenmao.CherryStudio'].includes(programName)

    if (!isSelf) {
      // [macOS] an ugly hacky way
      // `focusable: true` will make mainWindow disappeared when `setVisibleOnAllWorkspaces`
      // so we set `focusable: true` before showing, and then set false after showing
      this.toolbarWindow!.setFocusable(false)

      // [macOS]
      // force `setVisibleOnAllWorkspaces: true` to let toolbar show in all workspaces. And we MUST not set it to false again
      // set `skipTransformProcessType: true` to avoid dock icon spinning when `setVisibleOnAllWorkspaces`
      this.toolbarWindow!.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
    }

    // [macOS] MUST use `showInactive()` to prevent other windows bring to front together
    // [Windows] is OK for both `show()` and `showInactive()` because of `focusable: false`
    this.toolbarWindow!.showInactive()

    // [macOS] restore the focusable status
    this.toolbarWindow!.setFocusable(true)

    // Mouse-key hook start fires from window.on('show') in setupToolbarBehavior
    // (showInactive also fires 'show').

    return
  }

  /**
   * Hide the toolbar window and cleanup listeners
   */
  public hideToolbar(): void {
    if (!this.isToolbarAlive()) return

    // Mouse-key hook stop is driven by window.on('hide') in setupToolbarBehavior,
    // which covers this call site as well as the WM-driven blur → window.hide().
    //
    // On macOS, the toolbar's hide() call is wrapped by WindowManager's applyQuirks:
    //   - macRestoreFocusOnHide guards focus (setFocusable(false) on all visible windows, restored after 50ms)
    //   - macClearHoverOnHide sends a synthetic mouseMove(-1,-1) to clear any residual hover state
    // so this call site remains a plain .hide() on every platform.
    this.toolbarWindow!.hide()
  }

  /**
   * Check if toolbar window exists and is not destroyed
   * @returns {boolean} Toolbar window status
   */
  private isToolbarAlive(): boolean {
    return !!(this.toolbarWindow && !this.toolbarWindow.isDestroyed())
  }

  /**
   * Update toolbar size based on renderer feedback
   * Only updates width if it has changed
   * @param width New toolbar width
   * @param height New toolbar height
   */
  public determineToolbarSize(width: number, height: number): void {
    const toolbarWidth = Math.ceil(width)

    // only update toolbar width if it's changed
    if (toolbarWidth > 0 && toolbarWidth !== this.TOOLBAR_WIDTH && height > 0) {
      this.TOOLBAR_WIDTH = toolbarWidth
    }
  }

  /**
   * Get actual toolbar dimensions accounting for zoom factor
   * @returns Object containing toolbar width and height
   */
  private getToolbarRealSize(): { toolbarWidth: number; toolbarHeight: number } {
    return {
      toolbarWidth: this.TOOLBAR_WIDTH * this.zoomFactor,
      toolbarHeight: this.TOOLBAR_HEIGHT * this.zoomFactor
    }
  }

  /**
   * Calculate optimal toolbar position based on selection context
   * Ensures toolbar stays within screen boundaries and follows selection direction
   * @param refPoint Reference point for positioning, must be INTEGER
   * @param orientation Preferred position relative to reference point
   * @returns Calculated screen coordinates for toolbar, INTEGER
   */
  private calculateToolbarPosition(refPoint: Point, orientation: RelativeOrientation): Point {
    // Calculate initial position based on the specified anchor
    const posPoint: Point = { x: 0, y: 0 }

    const { toolbarWidth, toolbarHeight } = this.getToolbarRealSize()

    switch (orientation) {
      case 'topLeft':
        posPoint.x = refPoint.x - toolbarWidth
        posPoint.y = refPoint.y - toolbarHeight
        break
      case 'topRight':
        posPoint.x = refPoint.x
        posPoint.y = refPoint.y - toolbarHeight
        break
      case 'topMiddle':
        posPoint.x = refPoint.x - toolbarWidth / 2
        posPoint.y = refPoint.y - toolbarHeight
        break
      case 'bottomLeft':
        posPoint.x = refPoint.x - toolbarWidth
        posPoint.y = refPoint.y
        break
      case 'bottomRight':
        posPoint.x = refPoint.x
        posPoint.y = refPoint.y
        break
      case 'bottomMiddle':
        posPoint.x = refPoint.x - toolbarWidth / 2
        posPoint.y = refPoint.y
        break
      case 'middleLeft':
        posPoint.x = refPoint.x - toolbarWidth
        posPoint.y = refPoint.y - toolbarHeight / 2
        break
      case 'middleRight':
        posPoint.x = refPoint.x
        posPoint.y = refPoint.y - toolbarHeight / 2
        break
      case 'center':
        posPoint.x = refPoint.x - toolbarWidth / 2
        posPoint.y = refPoint.y - toolbarHeight / 2
        break
      default:
        // Default to 'topMiddle' if invalid position
        posPoint.x = refPoint.x - toolbarWidth / 2
        posPoint.y = refPoint.y - toolbarHeight / 2
    }

    //use original point to get the display
    const display = screen.getDisplayNearestPoint(refPoint)

    //check if the toolbar exceeds the top or bottom of the screen
    const exceedsTop = posPoint.y < display.workArea.y
    const exceedsBottom = posPoint.y > display.workArea.y + display.workArea.height - toolbarHeight

    // Ensure toolbar stays within screen boundaries
    posPoint.x = Math.round(
      Math.max(display.workArea.x, Math.min(posPoint.x, display.workArea.x + display.workArea.width - toolbarWidth))
    )
    posPoint.y = Math.round(
      Math.max(display.workArea.y, Math.min(posPoint.y, display.workArea.y + display.workArea.height - toolbarHeight))
    )

    //adjust the toolbar position if it exceeds the top or bottom of the screen
    if (exceedsTop) {
      posPoint.y = posPoint.y + 32
    }
    if (exceedsBottom) {
      posPoint.y = posPoint.y - 32
    }

    return posPoint
  }

  private isSamePoint(point1: Point, point2: Point): boolean {
    return point1.x === point2.x && point1.y === point2.y
  }

  private isSameLineWithRectPoint(startTop: Point, startBottom: Point, endTop: Point, endBottom: Point): boolean {
    return startTop.y === endTop.y && startBottom.y === endBottom.y
  }

  /**
   * Get the user selected text and process it (trigger by shortcut)
   *
   * it's a public method used by shortcut service
   */
  public processSelectTextByShortcut(): void {
    if (!this.selectionHook || !this.isActivated || this.triggerMode !== SelectionTriggerMode.Shortcut) return

    const selectionData = this.selectionHook.getCurrentSelection()

    if (selectionData) {
      this.processTextSelection(selectionData)
    }
  }

  /**
   * Determine if the text selection should be processed by filter mode&list
   * @param selectionData Text selection information and coordinates
   * @returns {boolean} True if the selection should be processed, false otherwise
   */
  private shouldProcessTextSelection(selectionData: TextSelectionData): boolean {
    if (selectionData.programName === '' || this.filterMode === 'default') {
      return true
    }

    const programName = selectionData.programName.toLowerCase()
    //items in filterList are already in lower case
    const isFound = this.filterList.some((item) => programName.includes(item))

    switch (this.filterMode) {
      case 'whitelist':
        return isFound
      case 'blacklist':
        return !isFound
    }

    return false
  }

  /**
   * Process text selection data and show toolbar
   * Handles different selection scenarios:
   * - Single click (cursor position)
   * - Mouse selection (single/double line)
   * - Keyboard selection (full/detailed)
   * @param selectionData Text selection information and coordinates
   */
  private processTextSelection = (selectionData: TextSelectionData) => {
    if (!selectionData.text) {
      return
    }

    // Skip if toolbar already visible.
    // [Wayland] Allow new selections to reposition the toolbar by hiding it first.
    // This acts as a safety net: if blur fails to hide the toolbar on some compositors,
    // selecting new text will still dismiss and reposition it instead of getting stuck.
    if (this.isToolbarAlive() && this.toolbarWindow!.isVisible()) {
      if (this.isLinuxWaylandDisplay) {
        this.hideToolbar()
      } else {
        return
      }
    }

    if (!this.shouldProcessTextSelection(selectionData)) {
      return
    }

    // Determine reference point and position for toolbar
    let refPoint: { x: number; y: number } = { x: 0, y: 0 }
    let isLogical = false
    let refOrientation: RelativeOrientation = 'bottomRight'

    switch (selectionData.posLevel) {
      case SelectionHook?.PositionLevel.NONE:
        {
          const cursorPoint = screen.getCursorScreenPoint()
          refPoint = { x: cursorPoint.x, y: cursorPoint.y }
          refOrientation = 'bottomMiddle'
          isLogical = true
        }
        break
      case SelectionHook?.PositionLevel.MOUSE_SINGLE:
        {
          if (isLinux && selectionData.mousePosEnd.x === SelectionHook?.INVALID_COORDINATE) {
            // Wayland degraded mode: coordinates unavailable, fall back to Electron cursor position
            const cursorPoint = screen.getCursorScreenPoint()
            refPoint = { x: cursorPoint.x, y: cursorPoint.y }
            refOrientation = 'bottomMiddle'
            isLogical = true
          } else {
            refOrientation = 'bottomMiddle'
            refPoint = { x: selectionData.mousePosEnd.x, y: selectionData.mousePosEnd.y + 16 }
          }
        }
        break
      case SelectionHook?.PositionLevel.MOUSE_DUAL:
        {
          const yDistance = selectionData.mousePosEnd.y - selectionData.mousePosStart.y
          const xDistance = selectionData.mousePosEnd.x - selectionData.mousePosStart.x

          // not in the same line
          if (Math.abs(yDistance) > 14) {
            if (yDistance > 0) {
              refOrientation = 'bottomLeft'
              refPoint = {
                x: selectionData.mousePosEnd.x,
                y: selectionData.mousePosEnd.y + 16
              }
            } else {
              refOrientation = 'topRight'
              refPoint = {
                x: selectionData.mousePosEnd.x,
                y: selectionData.mousePosEnd.y - 16
              }
            }
          } else {
            // in the same line
            if (xDistance > 0) {
              refOrientation = 'bottomLeft'
              refPoint = {
                x: selectionData.mousePosEnd.x,
                y: Math.max(selectionData.mousePosEnd.y, selectionData.mousePosStart.y) + 16
              }
            } else {
              refOrientation = 'bottomRight'
              refPoint = {
                x: selectionData.mousePosEnd.x,
                y: Math.min(selectionData.mousePosEnd.y, selectionData.mousePosStart.y) + 16
              }
            }
          }
        }
        break
      case SelectionHook?.PositionLevel.SEL_FULL:
      case SelectionHook?.PositionLevel.SEL_DETAILED:
        {
          //some case may not have mouse position, so use the endBottom point as reference
          const isNoMouse =
            selectionData.mousePosStart.x === 0 &&
            selectionData.mousePosStart.y === 0 &&
            selectionData.mousePosEnd.x === 0 &&
            selectionData.mousePosEnd.y === 0

          if (isNoMouse) {
            refOrientation = 'bottomLeft'
            refPoint = { x: selectionData.endBottom.x, y: selectionData.endBottom.y + 4 }
            break
          }

          const isDoubleClick = this.isSamePoint(selectionData.mousePosStart, selectionData.mousePosEnd)

          const isSameLine = this.isSameLineWithRectPoint(
            selectionData.startTop,
            selectionData.startBottom,
            selectionData.endTop,
            selectionData.endBottom
          )

          // Note: shift key + mouse click == DoubleClick

          //double click to select a word
          if (isDoubleClick && isSameLine) {
            refOrientation = 'bottomMiddle'
            refPoint = { x: selectionData.mousePosEnd.x, y: selectionData.endBottom.y + 4 }
            break
          }

          // below: isDoubleClick || isSameLine
          if (isSameLine) {
            const direction = selectionData.mousePosEnd.x - selectionData.mousePosStart.x

            if (direction > 0) {
              refOrientation = 'bottomLeft'
              refPoint = { x: selectionData.endBottom.x, y: selectionData.endBottom.y + 4 }
            } else {
              refOrientation = 'bottomRight'
              refPoint = { x: selectionData.startBottom.x, y: selectionData.startBottom.y + 4 }
            }
            break
          }

          // below: !isDoubleClick && !isSameLine
          const direction = selectionData.mousePosEnd.y - selectionData.mousePosStart.y

          if (direction > 0) {
            refOrientation = 'bottomLeft'
            refPoint = { x: selectionData.endBottom.x, y: selectionData.endBottom.y + 4 }
          } else {
            refOrientation = 'topRight'
            refPoint = { x: selectionData.startTop.x, y: selectionData.startTop.y - 4 }
          }
        }
        break
    }

    if (!isLogical) {
      // [Windows/Linux] selection-hook returns physical pixels; convert to logical (DIP)
      if (isWin || isLinux) {
        refPoint = screen.screenToDipPoint(refPoint)
      }
      //screenToDipPoint can be float, so we need to round it
      refPoint = { x: Math.round(refPoint.x), y: Math.round(refPoint.y) }
    }

    // [macOS] isFullscreen is only available on macOS
    this.showToolbarAtPosition(refPoint, refOrientation, selectionData.programName)
    this.toolbarWindow!.webContents.send(IpcChannel.Selection_TextSelected, selectionData)
  }

  /**
   * Global Mouse Event Handling
   */

  // Start monitoring global mouse clicks
  private startHideByMouseKeyListener(): void {
    try {
      // [Wayland] Skip mouse-down listener — selection-hook reports Wayland compositor
      // coordinates while Electron getBounds() uses XWayland coordinates. This mismatch
      // makes isInsideToolbar hit-testing unreliable, so outside-click hiding on Wayland
      // is handled by blur (focusable: true) instead.
      if (!this.isLinuxWaylandDisplay) {
        this.selectionHook!.on('mouse-down', this.handleMouseDownHide)
      }
      this.selectionHook!.on('mouse-wheel', this.handleMouseWheelHide)
      this.selectionHook!.on('key-down', this.handleKeyDownHide)
      this.isHideByMouseKeyListenerActive = true
    } catch (error) {
      this.logError('Failed to start global mouse event listener:', error as Error)
    }
  }

  // Stop monitoring global mouse clicks
  private stopHideByMouseKeyListener(): void {
    if (!this.isHideByMouseKeyListenerActive) return

    try {
      if (!this.isLinuxWaylandDisplay) {
        this.selectionHook!.off('mouse-down', this.handleMouseDownHide)
      }
      this.selectionHook!.off('mouse-wheel', this.handleMouseWheelHide)
      this.selectionHook!.off('key-down', this.handleKeyDownHide)
      this.isHideByMouseKeyListenerActive = false
    } catch (error) {
      this.logError('Failed to stop global mouse event listener:', error as Error)
    }
  }

  /**
   * Handle mouse wheel events to hide toolbar
   * Hides toolbar when user scrolls
   * @param data Mouse wheel event data
   */
  private handleMouseWheelHide = () => {
    this.hideToolbar()
  }

  /**
   * Handle mouse down events to hide toolbar
   * Hides toolbar when clicking outside of it
   * @param data Mouse event data
   */
  private handleMouseDownHide = (data: MouseEventData) => {
    if (!this.isToolbarAlive()) {
      return
    }

    // [Windows/Linux] selection-hook returns physical pixels; convert to logical (DIP)
    const mousePoint = isWin || isLinux ? screen.screenToDipPoint({ x: data.x, y: data.y }) : { x: data.x, y: data.y }

    const bounds = this.toolbarWindow!.getBounds()

    // Check if click is outside toolbar
    const isInsideToolbar =
      mousePoint.x >= bounds.x &&
      mousePoint.x <= bounds.x + bounds.width &&
      mousePoint.y >= bounds.y &&
      mousePoint.y <= bounds.y + bounds.height

    if (!isInsideToolbar) {
      this.hideToolbar()
    }
  }

  /**
   * Handle key down events to hide toolbar
   * Hides toolbar on any key press except alt key in ctrlkey mode
   * @param data Keyboard event data
   */
  private handleKeyDownHide = (data: KeyboardEventData) => {
    //dont hide toolbar when ctrlkey is pressed
    if (this.triggerMode === SelectionTriggerMode.Ctrlkey && this.isCtrlkey(data.vkCode)) {
      return
    }
    //dont hide toolbar when shiftkey or altkey is pressed, because it's used for selection
    if (this.isShiftkey(data.vkCode) || this.isAltkey(data.vkCode)) {
      return
    }

    this.hideToolbar()
  }

  /**
   * Handle key down events in ctrlkey trigger mode
   * Processes alt key presses to trigger selection toolbar
   * @param data Keyboard event data
   */
  private handleKeyDownCtrlkeyMode = (data: KeyboardEventData) => {
    if (!this.isCtrlkey(data.vkCode)) {
      // reset the lastCtrlkeyDownTime if any other key is pressed
      if (this.lastCtrlkeyDownTime > 0) {
        this.lastCtrlkeyDownTime = -1
      }
      return
    }

    if (this.lastCtrlkeyDownTime === -1) {
      return
    }

    //ctrlkey pressed
    if (this.lastCtrlkeyDownTime === 0) {
      this.lastCtrlkeyDownTime = Date.now()
      //add the mouse-wheel&mouse-down listener, detect if user is zooming in/out or multi-selecting
      this.selectionHook!.on('mouse-wheel', this.handleMouseWheelCtrlkeyMode)
      this.selectionHook!.on('mouse-down', this.handleMouseDownCtrlkeyMode)
      return
    }

    if (Date.now() - this.lastCtrlkeyDownTime < 350) {
      return
    }

    this.lastCtrlkeyDownTime = -1

    const selectionData = this.selectionHook!.getCurrentSelection()
    if (selectionData) {
      this.processTextSelection(selectionData)
    }
  }

  /**
   * Handle key up events in ctrlkey trigger mode
   * Resets alt key state when key is released
   * @param data Keyboard event data
   */
  private handleKeyUpCtrlkeyMode = (data: KeyboardEventData) => {
    if (!this.isCtrlkey(data.vkCode)) return
    //remove the mouse-wheel&mouse-down listener
    this.selectionHook!.off('mouse-wheel', this.handleMouseWheelCtrlkeyMode)
    this.selectionHook!.off('mouse-down', this.handleMouseDownCtrlkeyMode)
    this.lastCtrlkeyDownTime = 0
  }

  /**
   * Handle mouse wheel events in ctrlkey trigger mode
   * ignore CtrlKey pressing when mouse wheel is used
   * because user is zooming in/out
   */
  private handleMouseWheelCtrlkeyMode = () => {
    this.lastCtrlkeyDownTime = -1
  }

  /**
   * Handle mouse down events in ctrlkey trigger mode
   * ignore CtrlKey pressing when mouse down is used
   * because user is multi-selecting
   */
  private handleMouseDownCtrlkeyMode = () => {
    this.lastCtrlkeyDownTime = -1
  }

  // Check if the key is ctrl key
  // Windows: VK_LCONTROL(162), VK_RCONTROL(163)
  // macOS: kVK_Control(59), kVK_RightControl(62)
  private isCtrlkey(vkCode: number) {
    if (isMac) {
      return vkCode === 59 || vkCode === 62
    }
    return vkCode === 162 || vkCode === 163
  }

  // Check if the key is shift key
  // Windows: VK_LSHIFT(160), VK_RSHIFT(161)
  // macOS: kVK_Shift(56), kVK_RightShift(60)
  private isShiftkey(vkCode: number) {
    if (isMac) {
      return vkCode === 56 || vkCode === 60
    }
    return vkCode === 160 || vkCode === 161
  }

  // Check if the key is alt/option key
  // Windows: VK_LMENU(164), VK_RMENU(165)
  // macOS: kVK_Option(58), kVK_RightOption(61)
  private isAltkey(vkCode: number) {
    if (isMac) {
      return vkCode === 58 || vkCode === 61
    }
    return vkCode === 164 || vkCode === 165
  }

  /**
   * Release all activation-scoped resources.
   * Uses stop() + removeAllListeners() instead of cleanup() to preserve the native instance
   * for efficient reactivation. Safe to call even if onActivate() never ran or partially ran.
   *
   * Note on action windows: we intentionally DO NOT destroy in-use action windows —
   * users may still be reading those results. The WindowManager pool is suspended
   * (idle windows destroyed, no further warmup), but in-use windows stay alive until
   * the user closes them (suspendPool only destroys idle, never managed).
   */
  private releaseActivationResources(): void {
    if (this.selectionHook) {
      try {
        this.selectionHook.stop()
        this.selectionHook.removeAllListeners()
      } catch (error) {
        this.logError('Failed to stop selection hook:', error as Error)
      }
    }

    for (const unsub of this.unsubscriberForChangeListeners) {
      unsub()
    }
    this.unsubscriberForChangeListeners = []

    this.isCtrlkeyListenerActive = false
    this.isHideByMouseKeyListenerActive = false
    this.lastCtrlkeyDownTime = 0

    const wm = application.get('WindowManager')

    // Destroy toolbar (singleton — not pooled)
    if (this.toolbarWindowId) {
      wm.destroy(this.toolbarWindowId)
      // toolbarWindow / toolbarWindowId are cleared by the onWindowDestroyed handler in onInit().
    }

    // Suspend the action pool — destroys idle windows and disables further warmup until
    // resumePool() is called on next activate. In-use windows are NOT destroyed here,
    // preserving user-visible results.
    wm.suspendPool(WindowType.SelectionAction)
  }

  /**
   * Process action item
   * @param actionItem Action item to process
   * @param isFullScreen [macOS] only macOS has the available isFullscreen mode
   */
  public processAction(actionItem: SelectionActionItem, isFullScreen: boolean = false): void {
    const wm = application.get('WindowManager')

    // open({ initData }) atomically stores the action payload and, for the
    // pool-recycle path, emits WindowManager_Reused with the same payload so
    // the renderer can update in-place. For recycled windows the renderer has
    // been mounted and its listener registered since warmup, so the DOM is
    // ready on the next tick. For fresh windows the renderer mounts,
    // `useWindowInitData` pulls the payload via `getInitData`, and React
    // paints before the user notices. This mirrors the behavior of the
    // pre-WindowManager SelectionService: push data, then show immediately.
    const windowId = wm.open(WindowType.SelectionAction, {
      initData: actionItem,
      options: {
        width: this.isRemeberWinSize ? this.lastActionWindowSize.width : this.ACTION_WINDOW_WIDTH,
        height: this.isRemeberWinSize ? this.lastActionWindowSize.height : this.ACTION_WINDOW_HEIGHT
      }
    })

    const actionWindow = wm.getWindow(windowId)
    if (!actionWindow) {
      this.logError(`Failed to get action window ${windowId}`)
      return
    }

    this.showActionWindow(actionWindow, isFullScreen)
  }

  /**
   * Show action window with proper positioning relative to toolbar
   * Ensures window stays within screen boundaries
   * @param actionWindow Window to position and show
   * @param isFullScreen [macOS] only macOS has the available isFullscreen mode
   */
  private showActionWindow(actionWindow: BrowserWindow, isFullScreen: boolean = false): void {
    let actionWindowWidth = this.ACTION_WINDOW_WIDTH
    let actionWindowHeight = this.ACTION_WINDOW_HEIGHT

    //if remember win size is true, use the last remembered size
    if (this.isRemeberWinSize) {
      actionWindowWidth = this.lastActionWindowSize.width
      actionWindowHeight = this.lastActionWindowSize.height
    }

    /********************************************
     * Setting the position of the action window
     ********************************************/
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const workArea = display.workArea

    // Center of the screen
    if (!this.isFollowToolbar || !this.toolbarWindow) {
      const centerX = Math.round(workArea.x + (workArea.width - actionWindowWidth) / 2)
      const centerY = Math.round(workArea.y + (workArea.height - actionWindowHeight) / 2)

      actionWindow.setPosition(centerX, centerY, false)
      actionWindow.setBounds({
        width: actionWindowWidth,
        height: actionWindowHeight,
        x: centerX,
        y: centerY
      })
    } else {
      // Follow toolbar position
      const toolbarBounds = this.toolbarWindow.getBounds()
      const GAP = 6 // 6px gap from screen edges

      //make sure action window is inside screen
      if (actionWindowWidth > workArea.width - 2 * GAP) {
        actionWindowWidth = workArea.width - 2 * GAP
      }

      if (actionWindowHeight > workArea.height - 2 * GAP) {
        actionWindowHeight = workArea.height - 2 * GAP
      }

      // Calculate initial position to center action window horizontally below toolbar
      let posX = Math.round(toolbarBounds.x + (toolbarBounds.width - actionWindowWidth) / 2)
      let posY = Math.round(toolbarBounds.y)

      // Ensure action window stays within screen boundaries with a small gap
      if (posX + actionWindowWidth > workArea.x + workArea.width) {
        posX = workArea.x + workArea.width - actionWindowWidth - GAP
      } else if (posX < workArea.x) {
        posX = workArea.x + GAP
      }
      if (posY + actionWindowHeight > workArea.y + workArea.height) {
        // If window would go below screen, try to position it above toolbar
        posY = workArea.y + workArea.height - actionWindowHeight - GAP
      } else if (posY < workArea.y) {
        posY = workArea.y + GAP
      }

      actionWindow.setPosition(posX, posY, false)
      //KEY to make window not resize
      actionWindow.setBounds({
        width: actionWindowWidth,
        height: actionWindowHeight,
        x: posX,
        y: posY
      })
    }

    if (!isMac) {
      actionWindow.show()
      return
    }

    /************************************************
     * [macOS] the following code is only for macOS
     *
     * WARNING:
     *   DO NOT MODIFY THESE CODES, UNLESS YOU REALLY KNOW WHAT YOU ARE DOING!!!!
     *************************************************/

    // act normally when the app is not in fullscreen mode
    if (!isFullScreen) {
      actionWindow.show()
      return
    }

    // [macOS] an UGLY HACKY way for fullscreen override settings

    // FIXME sometimes the dock will be shown when the action window is shown
    // FIXME if actionWindow show on the fullscreen app, switch to other space will cause the mainWindow to be shown
    // FIXME When setVisibleOnAllWorkspaces is true, docker icon disappeared when the first action window is shown on the fullscreen app
    //       use app.dock.show() to show the dock again will cause the action window to be closed when auto hide on blur is enabled

    // setFocusable(false) to prevent the action window hide when blur (if auto hide on blur is enabled)
    actionWindow.setFocusable(false)
    // No explicit level: Electron defaults to 'floating' on macOS, and
    // SelectionAction's registry intentionally declares no alwaysOnTop.level
    // (the pin toggle and this show sequence use the same default path).
    actionWindow.setAlwaysOnTop(true)

    // `setVisibleOnAllWorkspaces(true)` will cause the dock icon disappeared
    // just store the dock icon status, and show it again
    const isDockShown = app.dock?.isVisible()

    // DO NOT set `skipTransformProcessType: true`,
    // it will cause the action window to be shown on other space
    actionWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })

    actionWindow.showInactive()

    // show the dock again if last time it was shown
    // do not put it after `actionWindow.focus()`, will cause the action window to be closed when auto hide on blur is enabled
    if (!app.dock?.isVisible() && isDockShown) {
      void app.dock?.show()
    }

    // unset everything
    setTimeout(() => {
      if (actionWindow.isDestroyed()) return
      actionWindow.setVisibleOnAllWorkspaces(false, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
      actionWindow.setAlwaysOnTop(false)

      actionWindow.setFocusable(true)

      // regain the focus when all the works done
      actionWindow.focus()
    }, 50)
  }

  public pinActionWindow(actionWindow: BrowserWindow, isPinned: boolean): void {
    if (actionWindow.isDestroyed()) return
    // Route through WindowManager so any future `behavior.alwaysOnTop` on the
    // SelectionAction registry entry (currently none) flows automatically.
    // With no level declared, this is equivalent to `setAlwaysOnTop(isPinned)`.
    const wm = application.get('WindowManager')
    const id = wm.getWindowId(actionWindow)
    if (id !== undefined) {
      wm.behavior.setAlwaysOnTop(id, isPinned)
    } else {
      // Untracked window (shouldn't happen in the normal pooled flow).
      actionWindow.setAlwaysOnTop(isPinned)
    }
  }

  /**
   * Update trigger mode behavior
   * Switches between selection-based and alt-key based triggering
   * Manages appropriate event listeners for each mode
   */
  private processTriggerMode(): void {
    if (!this.selectionHook) return

    switch (this.triggerMode) {
      case SelectionTriggerMode.Selected:
        if (this.isCtrlkeyListenerActive) {
          this.selectionHook.off('key-down', this.handleKeyDownCtrlkeyMode)
          this.selectionHook.off('key-up', this.handleKeyUpCtrlkeyMode)

          this.isCtrlkeyListenerActive = false
        }

        this.selectionHook.setSelectionPassiveMode(false)
        break
      case SelectionTriggerMode.Ctrlkey:
        if (!this.isCtrlkeyListenerActive) {
          this.selectionHook.on('key-down', this.handleKeyDownCtrlkeyMode)
          this.selectionHook.on('key-up', this.handleKeyUpCtrlkeyMode)

          this.isCtrlkeyListenerActive = true
        }

        this.selectionHook.setSelectionPassiveMode(true)
        break
      case SelectionTriggerMode.Shortcut:
        //remove the ctrlkey listener, don't need any key listener for shortcut mode
        if (this.isCtrlkeyListenerActive) {
          this.selectionHook.off('key-down', this.handleKeyDownCtrlkeyMode)
          this.selectionHook.off('key-up', this.handleKeyUpCtrlkeyMode)

          this.isCtrlkeyListenerActive = false
        }

        this.selectionHook.setSelectionPassiveMode(true)
        break
    }
  }

  public writeToClipboard(text: string): boolean {
    if (isLinux) {
      try {
        clipboard.writeText(text)
        return true
      } catch (error) {
        logger.error('Failed to write to clipboard on Linux:', error as Error)
        return false
      }
    }
    if (!this.selectionHook || !this.isActivated) return false
    return this.selectionHook.writeToClipboard(text)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Selection_ToolbarHide, () => {
      this.hideToolbar()
    })

    this.ipcHandle(IpcChannel.Selection_WriteToClipboard, (_, text: string): boolean => {
      return this.writeToClipboard(text) ?? false
    })

    this.ipcHandle(IpcChannel.Selection_ToolbarDetermineSize, (_, width: number, height: number) => {
      this.determineToolbarSize(width, height)
    })

    // [macOS] only macOS has the available isFullscreen mode
    this.ipcHandle(
      IpcChannel.Selection_ProcessAction,
      (_, actionItem: SelectionActionItem, isFullScreen: boolean = false) => {
        this.processAction(actionItem, isFullScreen)
      }
    )

    // Helper: resolve an action window from an IPC event via WindowManager.
    // Falls back to BrowserWindow.fromWebContents if the window is not tracked by WM
    // (e.g., race conditions during deactivate), matching the pre-migration behavior.
    const resolveActionWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
      const wm = application.get('WindowManager')
      const windowId = wm.getWindowIdByWebContents(event.sender)
      if (windowId) {
        return wm.getWindow(windowId) ?? null
      }
      return BrowserWindow.fromWebContents(event.sender)
    }

    this.ipcHandle(IpcChannel.Selection_ActionWindowPin, (event, isPinned: boolean) => {
      const actionWindow = resolveActionWindow(event)
      if (actionWindow && !actionWindow.isDestroyed()) {
        this.pinActionWindow(actionWindow, isPinned)
      }
    })

    if (isLinux) {
      this.ipcHandle(IpcChannel.Selection_GetLinuxEnvInfo, () => {
        return this.getLinuxEnvInfo()
      })
    }
  }

  private logInfo(message: string, forceShow: boolean = false): void {
    if (isDev || forceShow) {
      logger.info(message)
    }
  }

  private logError(message: string, error?: Error): void {
    logger.error(message, error)
  }
}

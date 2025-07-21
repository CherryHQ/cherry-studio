import { loggerService } from '@logger'
import { SELECTION_FINETUNED_LIST, SELECTION_PREDEFINED_BLACKLIST } from '@main/configs/SelectionConfig'
import { isDev, isMac, isWin } from '@main/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, ipcMain, screen, systemPreferences } from 'electron'
import { join } from 'path'
import type {
  KeyboardEventData,
  MouseEventData,
  SelectionHookConstructor,
  SelectionHookInstance,
  TextSelectionData
} from 'selection-hook'

import type { ActionItem } from '../../renderer/src/types/selectionTypes'
import { ConfigKeys, configManager } from './ConfigManager'
import storeSyncService from './StoreSyncService'

const logger = loggerService.withContext('SelectionService')

const isSupportedOS = isWin || isMac

let SelectionHook: SelectionHookConstructor | null = null
try {
  //since selection-hook v1.0.0, it supports macOS
  if (isSupportedOS) {
    SelectionHook = require('selection-hook')
  }
} catch (error) {
  logger.error('Failed to load selection-hook:', error as Error)
}

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

enum TriggerMode {
  Selected = 'selected',
  Ctrlkey = 'ctrlkey',
  Shortcut = 'shortcut'
}

/** SelectionService is a singleton class that manages the selection hook and the toolbar window
 *
 * Features:
 * - Text selection detection and processing
 * - Floating toolbar management
 * - Action window handling
 * - Multiple trigger modes (selection/alt-key)
 * - Screen boundary-aware positioning
 *
 * Usage:
 *   import selectionService from '/src/main/services/SelectionService'
 *   selectionService?.start()
 */
export class SelectionService {
  private static instance: SelectionService | null = null
  private selectionHook: SelectionHookInstance | null = null

  private static isIpcHandlerRegistered = false

  private initStatus: boolean = false
  private started: boolean = false

  private triggerMode = TriggerMode.Selected
  private isFollowToolbar = true
  private isRemeberWinSize = false
  private filterMode = 'default'
  private filterList: string[] = []

  private toolbarWindow: BrowserWindow | null = null
  private actionWindows = new Set<BrowserWindow>()
  private preloadedActionWindows: BrowserWindow[] = []
  private readonly PRELOAD_ACTION_WINDOW_COUNT = 1

  private isHideByMouseKeyListenerActive: boolean = false
  private isCtrlkeyListenerActive: boolean = false
  /**
   * Ctrlkey action states:
   * 0 - Ready to monitor ctrlkey action
   * >0 - Currently monitoring ctrlkey action
   * -1 - Ctrlkey action triggered, no need to process again
   */
  private lastCtrlkeyDownTime: number = 0

  private zoomFactor: number = 1

  private TOOLBAR_WIDTH = 350
  private TOOLBAR_HEIGHT = 43

  private readonly ACTION_WINDOW_WIDTH = 500
  private readonly ACTION_WINDOW_HEIGHT = 400

  private lastActionWindowSize: { width: number; height: number } = {
    width: this.ACTION_WINDOW_WIDTH,
    height: this.ACTION_WINDOW_HEIGHT
  }

  private constructor() {
    try {
      if (!SelectionHook) {
        throw new Error('module selection-hook not exists')
      }

      this.selectionHook = new SelectionHook()
      if (this.selectionHook) {
        this.initZoomFactor()

        this.initStatus = true
      }
    } catch (error) {
      this.logError('Failed to initialize SelectionService:', error as Error)
    }
  }

  public static getInstance(): SelectionService | null {
    if (!isSupportedOS) return null

    if (!SelectionService.instance) {
      SelectionService.instance = new SelectionService()
    }

    if (SelectionService.instance.initStatus) {
      return SelectionService.instance
    }
    return null
  }

  public getSelectionHook(): SelectionHookInstance | null {
    return this.selectionHook
  }

  /**
   * Initialize zoom factor from config and subscribe to changes
   * Ensures UI elements scale properly with system DPI settings
   */
  private initZoomFactor(): void {
    const zoomFactor = configManager.getZoomFactor()
    if (zoomFactor) {
      this.setZoomFactor(zoomFactor)
    }

    configManager.subscribe('ZoomFactor', this.setZoomFactor)
  }

  public setZoomFactor = (zoomFactor: number) => {
    this.zoomFactor = zoomFactor
  }

  private initConfig(): void {
    this.triggerMode = configManager.getSelectionAssistantTriggerMode() as TriggerMode
    this.isFollowToolbar = configManager.getSelectionAssistantFollowToolbar()
    this.isRemeberWinSize = configManager.getSelectionAssistantRemeberWinSize()
    this.filterMode = configManager.getSelectionAssistantFilterMode()
    this.filterList = configManager.getSelectionAssistantFilterList()

    this.setHookGlobalFilterMode(this.filterMode, this.filterList)
    this.setHookFineTunedList()

    configManager.subscribe(ConfigKeys.SelectionAssistantTriggerMode, (triggerMode: TriggerMode) => {
      const oldTriggerMode = this.triggerMode

      this.triggerMode = triggerMode
      this.processTriggerMode()

      //trigger mode changed, need to update the filter list
      if (oldTriggerMode !== triggerMode) {
        this.setHookGlobalFilterMode(this.filterMode, this.filterList)
      }
    })

    configManager.subscribe(ConfigKeys.SelectionAssistantFollowToolbar, (isFollowToolbar: boolean) => {
      this.isFollowToolbar = isFollowToolbar
    })

    configManager.subscribe(ConfigKeys.SelectionAssistantRemeberWinSize, (isRemeberWinSize: boolean) => {
      this.isRemeberWinSize = isRemeberWinSize
      //when off, reset the last action window size to default
      if (!this.isRemeberWinSize) {
        this.lastActionWindowSize = {
          width: this.ACTION_WINDOW_WIDTH,
          height: this.ACTION_WINDOW_HEIGHT
        }
      }
    })

    configManager.subscribe(ConfigKeys.SelectionAssistantFilterMode, (filterMode: string) => {
      this.filterMode = filterMode
      this.setHookGlobalFilterMode(this.filterMode, this.filterList)
    })

    configManager.subscribe(ConfigKeys.SelectionAssistantFilterList, (filterList: string[]) => {
      this.filterList = filterList
      this.setHookGlobalFilterMode(this.filterMode, this.filterList)
    })
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
    if (this.triggerMode === TriggerMode.Selected) {
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
   * Start the selection service and initialize required windows
   * @returns {boolean} Success status of service start
   */
  public start(): boolean {
    if (!isSupportedOS) {
      this.logError('SelectionService start(): not supported on this OS')
      return false
    }

    if (!this.selectionHook) {
      this.logError('SelectionService start(): instance is null')
      return false
    }

    if (this.started) {
      this.logError('SelectionService start(): already started')
      return false
    }

    //On macOS, we need to check if the process is trusted
    if (isMac) {
      if (!systemPreferences.isTrustedAccessibilityClient(false)) {
        this.logError(
          'SelectionSerice not started: process is not trusted on macOS, please turn on the Accessibility permission'
        )
        return false
      }
    }

    try {
      //make sure the toolbar window is ready
      this.createToolbarWindow()
      // Initialize preloaded windows
      this.initPreloadedActionWindows()
      // Handle errors
      this.selectionHook.on('error', (error: { message: string }) => {
        this.logError('Error in SelectionHook:', error as Error)
      })
      // Handle text selection events
      this.selectionHook.on('text-selection', this.processTextSelection)

      // Start the hook
      if (this.selectionHook.start({ debug: isDev })) {
        //init basic configs
        this.initConfig()

        //init trigger mode configs
        this.processTriggerMode()

        this.started = true
        this.logInfo('SelectionService Started', true)
        return true
      }

      this.logError('Failed to start text selection hook.')
      return false
    } catch (error) {
      this.logError('Failed to set up text selection hook:', error as Error)
      return false
    }
  }

  /**
   * Stop the selection service and cleanup resources
   * Called when user disables selection assistant
   * @returns {boolean} Success status of service stop
   */
  public stop(): boolean {
    if (!this.selectionHook) return false

    this.selectionHook.stop()

    this.selectionHook.cleanup() //already remove all listeners

    //reset the listener states
    this.isCtrlkeyListenerActive = false
    this.isHideByMouseKeyListenerActive = false

    if (this.toolbarWindow) {
      this.toolbarWindow.close()
      this.toolbarWindow = null
    }

    this.closePreloadedActionWindows()

    this.started = false
    this.logInfo('SelectionService Stopped', true)
    return true
  }

  /**
   * Completely quit the selection service
   * Called when the app is closing
   */
  public quit(): void {
    if (!this.selectionHook) return

    this.stop()

    this.selectionHook = null
    this.initStatus = false
    SelectionService.instance = null
    this.logInfo('SelectionService Quitted', true)
  }

  /**
   * Toggle the enabled state of the selection service
   * Will sync the new enabled store to all renderer windows
   */
  public toggleEnabled(enabled: boolean | undefined = undefined): void {
    if (!this.selectionHook) return

    const newEnabled = enabled === undefined ? !configManager.getSelectionAssistantEnabled() : enabled

    configManager.setSelectionAssistantEnabled(newEnabled)

    //sync the new enabled state to all renderer windows
    storeSyncService.syncToRenderer('selectionStore/setSelectionEnabled', newEnabled)
  }

  /**
   * Create and configure the toolbar window
   * Sets up window properties, event handlers, and loads the toolbar UI
   * @param readyCallback Optional callback when window is ready to show
   */
  private createToolbarWindow(readyCallback?: () => void): void {
    if (this.isToolbarAlive()) return

    const { toolbarWidth, toolbarHeight } = this.getToolbarRealSize()

    this.toolbarWindow = new BrowserWindow({
      width: toolbarWidth,
      height: toolbarHeight,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false, // [macOS] must be false
      movable: true,
      hasShadow: false,
      thickFrame: false,
      roundedCorners: true,
      backgroundMaterial: 'none',

      // Platform specific settings
      //   [macOS] DO NOT set focusable to false, it will make other windows bring to front together
      //   [macOS] `panel` conflicts with other settings ,
      //           and log will show `NSWindow does not support nonactivating panel styleMask 0x80`
      //           but it seems still work on fullscreen apps, so we set this anyway
      ...(isWin ? { type: 'toolbar', focusable: false } : { type: 'panel' }),
      hiddenInMissionControl: true, // [macOS only]
      acceptFirstMouse: true, // [macOS only]

      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: isDev ? true : false
      }
    })

    // Hide when losing focus
    this.toolbarWindow.on('blur', () => {
      if (this.toolbarWindow!.isVisible()) {
        this.hideToolbar()
      }
    })

    // Clean up when closed
    this.toolbarWindow.on('closed', () => {
      if (!this.toolbarWindow?.isDestroyed()) {
        this.toolbarWindow?.destroy()
      }
      this.toolbarWindow = null
    })

    // Add show/hide event listeners
    this.toolbarWindow.on('show', () => {
      this.toolbarWindow?.webContents.send(IpcChannel.Selection_ToolbarVisibilityChange, true)
    })

    this.toolbarWindow.on('hide', () => {
      this.toolbarWindow?.webContents.send(IpcChannel.Selection_ToolbarVisibilityChange, false)
    })

    /** uncomment to open dev tools in dev mode */
    // if (isDev) {
    //   this.toolbarWindow.once('ready-to-show', () => {
    //     this.toolbarWindow!.webContents.openDevTools({ mode: 'detach' })
    //   })
    // }

    if (readyCallback) {
      this.toolbarWindow.once('ready-to-show', readyCallback)
    }

    /** get ready to load the toolbar window */

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.toolbarWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/selectionToolbar.html')
    } else {
      this.toolbarWindow.loadFile(join(__dirname, '../renderer/selectionToolbar.html'))
    }
  }

  /**
   * Show toolbar at specified position with given orientation
   * @param point Reference point for positioning, logical coordinates
   * @param orientation Preferred position relative to reference point
   */
  private showToolbarAtPosition(point: Point, orientation: RelativeOrientation, programName: string): void {
    if (!this.isToolbarAlive()) {
      this.createToolbarWindow(() => {
        this.showToolbarAtPosition(point, orientation, programName)
      })
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

    //set the window to always on top (highest level)
    //should set every time the window is shown
    this.toolbarWindow!.setAlwaysOnTop(true, 'screen-saver')

    if (!isMac) {
      this.toolbarWindow!.show()
      /**
       * [Windows]
       *   In Windows 10, setOpacity(1) will make the window completely transparent
       *   It's a strange behavior, so we don't use it for compatibility
       */
      // this.toolbarWindow!.setOpacity(1)
      this.startHideByMouseKeyListener()
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

    this.startHideByMouseKeyListener()

    return
  }

  /**
   * Hide the toolbar window and cleanup listeners
   */
  public hideToolbar(): void {
    if (!this.isToolbarAlive()) return

    this.stopHideByMouseKeyListener()

    // [Windows] just hide the toolbar window is enough
    if (!isMac) {
      this.toolbarWindow!.hide()
      return
    }

    /************************************************
     * [macOS] the following code is only for macOS
     *************************************************/

    // [macOS] a HACKY way
    // make sure other windows do not bring to front when toolbar is hidden
    // get all focusable windows and set them to not focusable
    const focusableWindows: BrowserWindow[] = []
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.isVisible()) {
        if (window.isFocusable()) {
          focusableWindows.push(window)
          window.setFocusable(false)
        }
      }
    }

    this.toolbarWindow!.hide()

    // set them back to focusable after 50ms
    setTimeout(() => {
      for (const window of focusableWindows) {
        if (!window.isDestroyed()) {
          window.setFocusable(true)
        }
      }
    }, 50)

    // [macOS] hacky way
    // Because toolbar is not a FOCUSED window, so the hover status will remain when next time show
    // so we just send mouseMove event to the toolbar window to make the hover status disappear
    this.toolbarWindow!.webContents.sendInputEvent({
      type: 'mouseMove',
      x: -1,
      y: -1
    })

    return
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

    // Ensure toolbar stays within screen boundaries
    posPoint.x = Math.round(
      Math.max(display.workArea.x, Math.min(posPoint.x, display.workArea.x + display.workArea.width - toolbarWidth))
    )
    posPoint.y = Math.round(
      Math.max(display.workArea.y, Math.min(posPoint.y, display.workArea.y + display.workArea.height - toolbarHeight))
    )

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
    if (!this.selectionHook || !this.started || this.triggerMode !== TriggerMode.Shortcut) return

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
    // Skip if no text or toolbar already visible
    if (!selectionData.text || (this.isToolbarAlive() && this.toolbarWindow!.isVisible())) {
      return
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
          refOrientation = 'bottomMiddle'
          refPoint = { x: selectionData.mousePosEnd.x, y: selectionData.mousePosEnd.y + 16 }
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
      // [macOS] don't need to convert by screenToDipPoint
      if (!isMac) {
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
      // Register event handlers
      this.selectionHook!.on('mouse-down', this.handleMouseDownHide)
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
      this.selectionHook!.off('mouse-down', this.handleMouseDownHide)
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

    //data point is physical coordinates, convert to logical coordinates(only for windows/linux)
    const mousePoint = isMac ? { x: data.x, y: data.y } : screen.screenToDipPoint({ x: data.x, y: data.y })

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
    if (this.triggerMode === TriggerMode.Ctrlkey && this.isCtrlkey(data.vkCode)) {
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

  //check if the key is ctrl key
  private isCtrlkey(vkCode: number) {
    return vkCode === 162 || vkCode === 163
  }

  //check if the key is shift key
  private isShiftkey(vkCode: number) {
    return vkCode === 160 || vkCode === 161
  }

  //check if the key is alt key
  private isAltkey(vkCode: number) {
    return vkCode === 164 || vkCode === 165
  }

  /**
   * Create a preloaded action window for quick response
   * Action windows handle specific operations on selected text
   * @returns Configured BrowserWindow instance
   */
  private createPreloadedActionWindow(): BrowserWindow {
    const preloadedActionWindow = new BrowserWindow({
      width: this.isRemeberWinSize ? this.lastActionWindowSize.width : this.ACTION_WINDOW_WIDTH,
      height: this.isRemeberWinSize ? this.lastActionWindowSize.height : this.ACTION_WINDOW_HEIGHT,
      minWidth: 300,
      minHeight: 200,
      frame: false,
      transparent: true,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden', // [macOS]
      trafficLightPosition: { x: 12, y: 9 }, // [macOS]
      hasShadow: false,
      thickFrame: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: true
      }
    })

    // Load the base URL without action data
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      preloadedActionWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/selectionAction.html')
    } else {
      preloadedActionWindow.loadFile(join(__dirname, '../renderer/selectionAction.html'))
    }

    return preloadedActionWindow
  }

  /**
   * Initialize preloaded action windows
   * Creates a pool of windows at startup for faster response
   */
  private async initPreloadedActionWindows(): Promise<void> {
    try {
      // Create initial pool of preloaded windows
      for (let i = 0; i < this.PRELOAD_ACTION_WINDOW_COUNT; i++) {
        await this.pushNewActionWindow()
      }
    } catch (error) {
      this.logError('Failed to initialize preloaded windows:', error as Error)
    }
  }

  /**
   * Close all preloaded action windows
   */
  private closePreloadedActionWindows(): void {
    for (const actionWindow of this.preloadedActionWindows) {
      if (!actionWindow.isDestroyed()) {
        actionWindow.destroy()
      }
    }
  }

  /**
   * Preload a new action window asynchronously
   * This method is called after popping a window to ensure we always have windows ready
   */
  private async pushNewActionWindow(): Promise<void> {
    try {
      const actionWindow = this.createPreloadedActionWindow()
      this.preloadedActionWindows.push(actionWindow)
    } catch (error) {
      this.logError('Failed to push new action window:', error as Error)
    }
  }

  /**
   * Pop an action window from the preloadedActionWindows queue
   * Immediately returns a window and asynchronously creates a new one
   * @returns {BrowserWindow} The action window
   */
  private popActionWindow(): BrowserWindow {
    // Get a window from the preloaded queue or create a new one if empty
    const actionWindow = this.preloadedActionWindows.pop() || this.createPreloadedActionWindow()

    // Set up event listeners for this instance
    actionWindow.on('closed', () => {
      this.actionWindows.delete(actionWindow)
      if (!actionWindow.isDestroyed()) {
        actionWindow.destroy()
      }

      // [macOS] a HACKY way
      // make sure other windows do not bring to front when action window is closed
      if (isMac) {
        const focusableWindows: BrowserWindow[] = []
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && window.isVisible()) {
            if (window.isFocusable()) {
              focusableWindows.push(window)
              window.setFocusable(false)
            }
          }
        }
        setTimeout(() => {
          for (const window of focusableWindows) {
            if (!window.isDestroyed()) {
              window.setFocusable(true)
            }
          }
        }, 50)
      }
    })

    //remember the action window size
    actionWindow.on('resized', () => {
      if (this.isRemeberWinSize) {
        this.lastActionWindowSize = {
          width: actionWindow.getBounds().width,
          height: actionWindow.getBounds().height
        }
      }
    })

    this.actionWindows.add(actionWindow)

    // Asynchronously create a new preloaded window
    this.pushNewActionWindow()

    return actionWindow
  }

  /**
   * Process action item
   * @param actionItem Action item to process
   * @param isFullScreen [macOS] only macOS has the available isFullscreen mode
   */
  public processAction(actionItem: ActionItem, isFullScreen: boolean = false): void {
    const actionWindow = this.popActionWindow()

    actionWindow.webContents.send(IpcChannel.Selection_UpdateActionData, actionItem)

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
      const toolbarBounds = this.toolbarWindow!.getBounds()
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
    actionWindow.setAlwaysOnTop(true, 'floating')

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
      app.dock?.show()
    }

    // unset everything
    setTimeout(() => {
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

  public closeActionWindow(actionWindow: BrowserWindow): void {
    actionWindow.close()
  }

  public minimizeActionWindow(actionWindow: BrowserWindow): void {
    actionWindow.minimize()
  }

  public pinActionWindow(actionWindow: BrowserWindow, isPinned: boolean): void {
    actionWindow.setAlwaysOnTop(isPinned)
  }

  /**
   * Update trigger mode behavior
   * Switches between selection-based and alt-key based triggering
   * Manages appropriate event listeners for each mode
   */
  private processTriggerMode(): void {
    if (!this.selectionHook) return

    switch (this.triggerMode) {
      case TriggerMode.Selected:
        if (this.isCtrlkeyListenerActive) {
          this.selectionHook.off('key-down', this.handleKeyDownCtrlkeyMode)
          this.selectionHook.off('key-up', this.handleKeyUpCtrlkeyMode)

          this.isCtrlkeyListenerActive = false
        }

        this.selectionHook.setSelectionPassiveMode(false)
        break
      case TriggerMode.Ctrlkey:
        if (!this.isCtrlkeyListenerActive) {
          this.selectionHook.on('key-down', this.handleKeyDownCtrlkeyMode)
          this.selectionHook.on('key-up', this.handleKeyUpCtrlkeyMode)

          this.isCtrlkeyListenerActive = true
        }

        this.selectionHook.setSelectionPassiveMode(true)
        break
      case TriggerMode.Shortcut:
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
    if (!this.selectionHook || !this.started) return false
    return this.selectionHook.writeToClipboard(text)
  }

  /**
   * Register IPC handlers for communication with renderer process
   * Handles toolbar, action window, and selection-related commands
   */
  public static registerIpcHandler(): void {
    if (this.isIpcHandlerRegistered) return

    ipcMain.handle(IpcChannel.Selection_ToolbarHide, () => {
      selectionService?.hideToolbar()
    })

    ipcMain.handle(IpcChannel.Selection_WriteToClipboard, (_, text: string): boolean => {
      return selectionService?.writeToClipboard(text) ?? false
    })

    ipcMain.handle(IpcChannel.Selection_ToolbarDetermineSize, (_, width: number, height: number) => {
      selectionService?.determineToolbarSize(width, height)
    })

    ipcMain.handle(IpcChannel.Selection_SetEnabled, (_, enabled: boolean) => {
      configManager.setSelectionAssistantEnabled(enabled)
    })

    ipcMain.handle(IpcChannel.Selection_SetTriggerMode, (_, triggerMode: string) => {
      configManager.setSelectionAssistantTriggerMode(triggerMode)
    })

    ipcMain.handle(IpcChannel.Selection_SetFollowToolbar, (_, isFollowToolbar: boolean) => {
      configManager.setSelectionAssistantFollowToolbar(isFollowToolbar)
    })

    ipcMain.handle(IpcChannel.Selection_SetRemeberWinSize, (_, isRemeberWinSize: boolean) => {
      configManager.setSelectionAssistantRemeberWinSize(isRemeberWinSize)
    })

    ipcMain.handle(IpcChannel.Selection_SetFilterMode, (_, filterMode: string) => {
      configManager.setSelectionAssistantFilterMode(filterMode)
    })

    ipcMain.handle(IpcChannel.Selection_SetFilterList, (_, filterList: string[]) => {
      configManager.setSelectionAssistantFilterList(filterList)
    })

    // [macOS] only macOS has the available isFullscreen mode
    ipcMain.handle(IpcChannel.Selection_ProcessAction, (_, actionItem: ActionItem, isFullScreen: boolean = false) => {
      selectionService?.processAction(actionItem, isFullScreen)
    })

    ipcMain.handle(IpcChannel.Selection_ActionWindowClose, (event) => {
      const actionWindow = BrowserWindow.fromWebContents(event.sender)
      if (actionWindow) {
        selectionService?.closeActionWindow(actionWindow)
      }
    })

    ipcMain.handle(IpcChannel.Selection_ActionWindowMinimize, (event) => {
      const actionWindow = BrowserWindow.fromWebContents(event.sender)
      if (actionWindow) {
        selectionService?.minimizeActionWindow(actionWindow)
      }
    })

    ipcMain.handle(IpcChannel.Selection_ActionWindowPin, (event, isPinned: boolean) => {
      const actionWindow = BrowserWindow.fromWebContents(event.sender)
      if (actionWindow) {
        selectionService?.pinActionWindow(actionWindow, isPinned)
      }
    })

    this.isIpcHandlerRegistered = true
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

/**
 * Initialize selection service when app starts
 * Sets up config subscription and starts service if enabled
 * @returns {boolean} Success status of initialization
 */
export function initSelectionService(): boolean {
  if (!isSupportedOS) return false

  configManager.subscribe(ConfigKeys.SelectionAssistantEnabled, (enabled: boolean): void => {
    //avoid closure
    const ss = SelectionService.getInstance()
    if (!ss) {
      logger.error('SelectionService not initialized: instance is null')
      return
    }

    if (enabled) {
      ss.start()
    } else {
      ss.stop()
    }
  })

  if (!configManager.getSelectionAssistantEnabled()) return false

  const ss = SelectionService.getInstance()
  if (!ss) {
    logger.error('SelectionService not initialized: instance is null')
    return false
  }

  return ss.start()
}

const selectionService = SelectionService.getInstance()

export default selectionService

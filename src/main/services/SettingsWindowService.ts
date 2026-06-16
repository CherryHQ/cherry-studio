import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMac } from '@main/core/platform'
import { type WindowOptions, WindowType } from '@main/core/window/types'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { nativeTheme } from 'electron'

const logger = loggerService.withContext('SettingsWindowService')

// Settings window sizing — 80% of the main window with a hard floor for small
// windows and a ceiling for ultra-wide displays. This keeps the two-column
// settings layout comfortable without stretching empty content space on 2K/4K.
const SETTINGS_WINDOW_SIZE_RATIO = 0.8
const SETTINGS_WINDOW_MIN_WIDTH = 760
const SETTINGS_WINDOW_MAX_WIDTH = 1280
const SETTINGS_WINDOW_MIN_HEIGHT = 560

export function createSettingsWindowOptions(isMacPlatform: boolean, dark: boolean): Partial<WindowOptions> {
  return {
    darkTheme: dark,
    ...(!isMacPlatform && { backgroundColor: dark ? '#181818' : '#FFFFFF' })
  }
}

@Injectable('SettingsWindowService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class SettingsWindowService extends BaseService {
  private readonly settingsWindowCleanups = new Map<string, () => void>()

  protected async onInit() {
    const wm = application.get('WindowManager')

    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.Settings, ({ id, window }) => {
        this.setupSettingsWindow(id, window)
      })
    )
    this.registerDisposable(() => {
      for (const cleanup of this.settingsWindowCleanups.values()) {
        cleanup()
      }
      this.settingsWindowCleanups.clear()
    })

    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.SettingsWindow_Open, (_event, path?: unknown) => {
      return this.open(this.normalizePath(path))
    })
  }

  public open(path?: SettingsPath): string {
    const wm = application.get('WindowManager')
    const options = this.getWindowOptions()
    const windowId = wm.open(WindowType.Settings, {
      initData: this.normalizePath(path),
      options
    })
    this.syncSettingsWindowBounds(windowId, options)
    return windowId
  }

  private setupSettingsWindow(windowId: string, window: BrowserWindow): void {
    window.setTitle('')
    const webContents = window.webContents

    const onPageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault()
      window.setTitle('')
    }
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      window.off('closed', cleanup)
      if (!webContents.isDestroyed()) {
        webContents.off('page-title-updated', onPageTitleUpdated)
      }
      this.settingsWindowCleanups.delete(windowId)
    }

    window.once('closed', cleanup)
    webContents.on('page-title-updated', onPageTitleUpdated)
    this.settingsWindowCleanups.set(windowId, cleanup)
  }

  private getWindowOptions(): Partial<WindowOptions> {
    return {
      ...createSettingsWindowOptions(isMac, nativeTheme.shouldUseDarkColors),
      ...this.getCenteredBoundsOptions()
    }
  }

  // Settings window is sized to 80% of the main window and centered on it, with
  // min/max width guards to keep the two-column settings layout usable across
  // small and ultra-wide main-window sizes.
  private getCenteredBoundsOptions(): Pick<WindowOptions, 'x' | 'y' | 'width' | 'height'> | undefined {
    const mainWindow = application.get('WindowManager').getWindowsByType(WindowType.Main)[0]
    if (!mainWindow) return undefined

    const { x, y, width: mainWidth, height: mainHeight } = mainWindow.getBounds()
    if (mainWidth <= 0 || mainHeight <= 0) {
      logger.warn('Main window reported non-positive bounds; falling back to default settings window size', {
        bounds: { x, y, width: mainWidth, height: mainHeight }
      })
      return undefined
    }

    const width = Math.min(
      Math.max(Math.round(mainWidth * SETTINGS_WINDOW_SIZE_RATIO), SETTINGS_WINDOW_MIN_WIDTH),
      SETTINGS_WINDOW_MAX_WIDTH
    )
    const height = Math.max(Math.round(mainHeight * SETTINGS_WINDOW_SIZE_RATIO), SETTINGS_WINDOW_MIN_HEIGHT)

    return {
      x: Math.round(x + (mainWidth - width) / 2),
      y: Math.round(y + (mainHeight - height) / 2),
      width,
      height
    }
  }

  private syncSettingsWindowBounds(windowId: string, options: Partial<WindowOptions>): void {
    const { x, y, width, height } = options
    if (x === undefined || y === undefined || !width || !height) return

    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed()) return

    window.setBounds({ x, y, width, height })
  }

  private normalizePath(path: unknown): SettingsPath {
    return normalizeSettingsPath(path)
  }
}

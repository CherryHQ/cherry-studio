import { application } from '@application'
import { isMac } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type WindowOptions, WindowType } from '@main/core/window/types'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { nativeTheme } from 'electron'

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
      ...this.getMainWindowBoundsOptions()
    }
  }

  private getMainWindowBoundsOptions(): Pick<WindowOptions, 'x' | 'y' | 'width' | 'height'> | undefined {
    const wm = application.get('WindowManager')
    const mainWindowInfo = wm.getWindowsByType(WindowType.Main)[0]
    if (!mainWindowInfo) return undefined

    const mainWindow = wm.getWindow(mainWindowInfo.id)
    if (!mainWindow || mainWindow.isDestroyed()) return undefined

    const { x, y, width, height } = mainWindow.getBounds()
    if (width <= 0 || height <= 0) return undefined

    return { x, y, width, height }
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

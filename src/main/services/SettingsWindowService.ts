import { application } from '@application'
import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type WindowOptions, WindowType } from '@main/core/window/types'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { nativeTheme } from 'electron'

const logger = loggerService.withContext('SettingsWindowService')

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
  private readonly mainWindowsReadyForTabAttach = new Set<string>()
  private readonly pendingSettingsTabsByWindowId = new Map<string, Tab[]>()
  private readonly settingsWindowCleanups = new Map<string, () => void>()

  protected async onInit() {
    const wm = application.get('WindowManager')

    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.Settings, ({ id, window }) => {
        this.setupSettingsWindow(id, window)
      })
    )
    this.registerDisposable(
      wm.onWindowDestroyedByType(WindowType.Main, ({ id }) => {
        this.mainWindowsReadyForTabAttach.delete(id)
        this.pendingSettingsTabsByWindowId.delete(id)
      })
    )
    this.registerDisposable(() => {
      for (const cleanup of this.settingsWindowCleanups.values()) {
        cleanup()
      }
      this.settingsWindowCleanups.clear()
      this.mainWindowsReadyForTabAttach.clear()
      this.pendingSettingsTabsByWindowId.clear()
    })

    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.SettingsWindow_Open, (_event, path?: unknown) => {
      return this.open(this.normalizePath(path))
    })

    this.ipcHandle(IpcChannel.SettingsWindow_OpenInApp, (event, path?: unknown) => {
      return this.openInApp(this.normalizePath(path), event.sender)
    })

    this.ipcHandle(IpcChannel.Tab_AttachReady, (event) => {
      return this.markMainWindowReadyForTabAttach(event.sender)
    })
  }

  public open(path?: SettingsPath): string {
    const wm = application.get('WindowManager')
    return wm.open(WindowType.Settings, {
      initData: this.normalizePath(path),
      options: this.getWindowOptions()
    })
  }

  public openUsingPreference(path?: SettingsPath): string | boolean {
    const target = application.get('PreferenceService').get('app.settings.open_target')
    if (target === 'app') {
      return this.openInApp(path)
    }

    return this.open(path)
  }

  public openInApp(path?: SettingsPath, sender?: Electron.WebContents): boolean {
    try {
      const normalizedPath = this.normalizePath(path)
      const wm = application.get('WindowManager')

      application.get('MainWindowService').showMainWindow()
      this.attachSettingsTabToMain(normalizedPath)

      const senderId = sender ? wm.getWindowIdByWebContents(sender) : null
      const isSettingsWindow = senderId
        ? wm.getWindowsByType(WindowType.Settings).some((windowInfo) => windowInfo.id === senderId)
        : false

      if (senderId && isSettingsWindow) {
        wm.close(senderId)
      }

      return true
    } catch (error) {
      logger.error('Failed to open settings in app', error as Error)
      throw error
    }
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
    return createSettingsWindowOptions(isMac, nativeTheme.shouldUseDarkColors)
  }

  private normalizePath(path: unknown): SettingsPath {
    return normalizeSettingsPath(path)
  }

  private attachSettingsTabToMain(path: SettingsPath): void {
    const wm = application.get('WindowManager')
    const tab = this.createSettingsTab(path)

    for (const windowInfo of wm.getWindowsByType(WindowType.Main)) {
      this.sendOrQueueSettingsTab(windowInfo.id, tab)
    }
  }

  private markMainWindowReadyForTabAttach(sender: Electron.WebContents): boolean {
    const wm = application.get('WindowManager')
    const windowId = wm.getWindowIdByWebContents(sender)
    if (!windowId || !wm.getWindowsByType(WindowType.Main).some((windowInfo) => windowInfo.id === windowId)) {
      return false
    }

    this.mainWindowsReadyForTabAttach.add(windowId)
    const pendingTabs = this.pendingSettingsTabsByWindowId.get(windowId)
    if (pendingTabs) {
      this.pendingSettingsTabsByWindowId.delete(windowId)
      for (const tab of pendingTabs) {
        this.sendSettingsTabToMain(windowId, tab)
      }
    }
    return true
  }

  private sendOrQueueSettingsTab(windowId: string, tab: Tab): void {
    if (this.mainWindowsReadyForTabAttach.has(windowId)) {
      this.sendSettingsTabToMain(windowId, tab)
      return
    }

    const pendingTabs = this.pendingSettingsTabsByWindowId.get(windowId) ?? []
    pendingTabs.push(tab)
    this.pendingSettingsTabsByWindowId.set(windowId, pendingTabs)
  }

  private sendSettingsTabToMain(windowId: string, tab: Tab): void {
    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed()) return
    window.webContents.send(IpcChannel.Tab_Attach, tab)
  }

  private createSettingsTab(path: SettingsPath): Tab {
    return {
      id: `settings:${path}`,
      type: 'route',
      url: path,
      title: 'Settings',
      lastAccessTime: Date.now(),
      isDormant: false
    }
  }
}

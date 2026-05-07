import { application } from '@application'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isMac } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type WindowOptions, WindowType } from '@main/core/window/types'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { nativeTheme } from 'electron'

const DEFAULT_SETTINGS_PATH = '/settings/provider'

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

    this.ipcHandle(IpcChannel.SettingsWindow_Open, (_event, path?: unknown) => {
      return this.open(path)
    })

    this.ipcHandle(IpcChannel.SettingsWindow_OpenInApp, (event, path?: unknown) => {
      return this.openInApp(path, event.sender)
    })

    this.ipcHandle(IpcChannel.Tab_AttachReady, (event) => {
      return this.markMainWindowReadyForTabAttach(event.sender)
    })
  }

  public open(path?: unknown): string {
    const wm = application.get('WindowManager')
    return wm.open(WindowType.Settings, {
      initData: this.normalizePath(path),
      options: this.getWindowOptions()
    })
  }

  public openInApp(path?: unknown, sender?: Electron.WebContents): boolean {
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
    const dark = nativeTheme.shouldUseDarkColors

    return {
      darkTheme: dark,
      ...(isMac && { titleBarOverlay: dark ? titleBarOverlayDark : titleBarOverlayLight }),
      ...(!isMac && { backgroundColor: dark ? '#181818' : '#FFFFFF' })
    }
  }

  private normalizePath(path: unknown): string {
    if (typeof path === 'string' && path.startsWith('/settings')) {
      return path
    }
    return DEFAULT_SETTINGS_PATH
  }

  private attachSettingsTabToMain(path: string): void {
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

  private createSettingsTab(path: string): Tab {
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

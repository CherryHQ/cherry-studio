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
const ATTACH_TO_MAIN_DELAY_MS = 100

@Injectable('SettingsWindowService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class SettingsWindowService extends BaseService {
  private readonly configuredWindowIds = new Set<string>()

  protected async onInit() {
    const wm = application.get('WindowManager')

    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.Settings, ({ id, window }) => {
        this.setupSettingsWindow(id, window)
      })
    )

    this.ipcHandle(IpcChannel.SettingsWindow_Open, (_event, path?: unknown) => {
      return this.open(path)
    })

    this.ipcHandle(IpcChannel.SettingsWindow_OpenInApp, (event, path?: unknown) => {
      return this.openInApp(path, event.sender)
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
    if (this.configuredWindowIds.has(windowId)) return
    this.configuredWindowIds.add(windowId)
    window.setTitle('')

    const onClosed = () => {
      this.configuredWindowIds.delete(windowId)
    }
    const onPageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault()
      window.setTitle('')
    }

    window.once('closed', onClosed)
    window.webContents.on('page-title-updated', onPageTitleUpdated)
    this.registerDisposable(() => {
      window.off('closed', onClosed)
      window.webContents.off('page-title-updated', onPageTitleUpdated)
    })
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

    const sendToWindow = (window: BrowserWindow) => {
      if (window.isDestroyed()) return

      if (window.webContents.isLoadingMainFrame()) {
        window.webContents.once('did-finish-load', () => {
          setTimeout(() => {
            if (!window.isDestroyed()) {
              window.webContents.send(IpcChannel.Tab_Attach, tab)
            }
          }, ATTACH_TO_MAIN_DELAY_MS)
        })
      } else {
        setTimeout(() => {
          if (!window.isDestroyed()) {
            window.webContents.send(IpcChannel.Tab_Attach, tab)
          }
        }, ATTACH_TO_MAIN_DELAY_MS)
      }
    }

    const sendToMainWindows = () => {
      const mainWindows = wm.getWindowsByType(WindowType.Main)

      for (const windowInfo of mainWindows) {
        const window = wm.getWindow(windowInfo.id)
        if (window) {
          sendToWindow(window)
        }
      }
    }

    if (wm.getWindowsByType(WindowType.Main).length === 0) {
      setTimeout(sendToMainWindows, ATTACH_TO_MAIN_DELAY_MS)
      return
    }

    sendToMainWindows()
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

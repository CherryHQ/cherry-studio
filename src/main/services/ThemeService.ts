import { IpcChannel } from '@shared/IpcChannel'
import { ThemeMode } from '@types'
import { BrowserWindow, nativeTheme } from 'electron'

import { titleBarOverlayDark, titleBarOverlayLight } from '../config'
import { configManager } from './ConfigManager'

class ThemeService {
  private theme: ThemeMode

  constructor() {
    this.theme = configManager.getTheme()
    nativeTheme.themeSource = this.theme
    nativeTheme.on('updated', this.themeUpdatadHandler.bind(this))
  }

  themeUpdatadHandler() {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed() && win.setTitleBarOverlay) {
        try {
          win.setTitleBarOverlay(nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight)
        } catch (error) {
          // don't throw error if setTitleBarOverlay failed
        }
      }
      win.webContents.send(IpcChannel.ThemeUpdated, nativeTheme.shouldUseDarkColors ? ThemeMode.dark : ThemeMode.light)
    })
  }

  setTheme(theme: ThemeMode) {
    if (theme === this.theme) {
      return
    }

    this.theme = theme
    nativeTheme.themeSource = theme
    configManager.setTheme(theme)
  }

  initTheme() {
    this.theme = configManager.getTheme()

    if (this.theme === ThemeMode.dark || this.theme === ThemeMode.light) {
      nativeTheme.themeSource = this.theme
      return
    }

    // 兼容旧版本
    configManager.setTheme(ThemeMode.system)
    nativeTheme.themeSource = ThemeMode.system
  }

  getTheme() {
    return this.theme
  }
}

export const themeService = new ThemeService()

import { preferenceService } from '@data/PreferenceService'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, nativeTheme } from 'electron'

import { titleBarOverlayDark, titleBarOverlayLight } from '../config'

class ThemeService {
  private theme: ThemeMode = ThemeMode.system
  constructor() {
    this.theme = preferenceService.get('ui.theme_mode')

    if (this.theme === ThemeMode.dark || this.theme === ThemeMode.light || this.theme === ThemeMode.system) {
      nativeTheme.themeSource = this.theme
    } else {
      // 兼容旧版本
      preferenceService.set('ui.theme_mode', ThemeMode.system)
      nativeTheme.themeSource = ThemeMode.system
    }
    nativeTheme.on('updated', this.themeUpdatadHandler.bind(this))

    preferenceService.subscribeChange('ui.theme_mode', (newTheme) => {
      this.theme = newTheme
      nativeTheme.themeSource = newTheme
    })
  }

  themeUpdatadHandler() {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed() && win.setTitleBarOverlay) {
        try {
          win.setTitleBarOverlay(nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight)
        } catch (error) {
          // don't throw error if setTitleBarOverlay failed
          // Because it may be called with some windows have some title bar
        }
      }
      win.webContents.send(
        IpcChannel.NativeThemeUpdated,
        nativeTheme.shouldUseDarkColors ? ThemeMode.dark : ThemeMode.light
      )
    })
  }
}

export const themeService = new ThemeService()

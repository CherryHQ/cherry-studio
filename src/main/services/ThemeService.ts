import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, nativeTheme } from 'electron'

import { titleBarOverlayDark, titleBarOverlayLight } from '../config'

@Injectable('ThemeService')
@ServicePhase(Phase.WhenReady)
export class ThemeService extends BaseService {
  private theme: ThemeMode = ThemeMode.system
  private readonly boundThemeUpdatedHandler = this.themeUpdatedHandler.bind(this)

  protected async onInit() {
    const preferenceService = application.get('PreferenceService')
    this.theme = preferenceService.get('ui.theme_mode')

    if (this.theme === ThemeMode.dark || this.theme === ThemeMode.light || this.theme === ThemeMode.system) {
      nativeTheme.themeSource = this.theme
    } else {
      void preferenceService.set('ui.theme_mode', ThemeMode.system)
      nativeTheme.themeSource = ThemeMode.system
    }

    nativeTheme.on('updated', this.boundThemeUpdatedHandler)
    this.registerDisposable(() => nativeTheme.removeListener('updated', this.boundThemeUpdatedHandler))

    this.registerDisposable(
      preferenceService.subscribeChange('ui.theme_mode', (newTheme) => {
        this.theme = newTheme
        nativeTheme.themeSource = newTheme
      })
    )
  }

  private themeUpdatedHandler() {
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

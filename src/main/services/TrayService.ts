import { application } from '@application'
import { isLinux, isMac, isWin } from '@main/constant'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getI18n } from '@main/utils/language'
import type { MenuItemConstructorOptions } from 'electron'
import { Menu, nativeImage, nativeTheme, Tray } from 'electron'

import icon from '../../../build/tray_icon.png?asset'
import iconDark from '../../../build/tray_icon_dark.png?asset'
import iconLight from '../../../build/tray_icon_light.png?asset'

@Injectable('TrayService')
@ServicePhase(Phase.WhenReady)
export class TrayService extends BaseService implements Activatable {
  private tray: Tray | null = null
  private contextMenu: Menu | null = null

  protected async onInit() {
    this.watchConfigChanges()
  }

  protected async onReady() {
    if (application.get('PreferenceService').get('app.tray.enabled')) {
      await this.activate()
    }
  }

  onActivate(): void {
    const iconPath = isMac ? (nativeTheme.shouldUseDarkColors ? iconLight : iconDark) : icon
    const tray = new Tray(iconPath)

    if (isWin) {
      tray.setImage(iconPath)
    } else if (isMac) {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      resizedImage.setTemplateImage(true)
      tray.setImage(resizedImage)
    } else if (isLinux) {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      tray.setImage(resizedImage)
    }

    this.tray = tray

    this.updateContextMenu()

    if (isLinux) {
      this.tray.setContextMenu(this.contextMenu)
    }

    this.tray.setToolTip('Cherry Studio')

    this.tray.on('right-click', () => {
      if (this.contextMenu) {
        this.tray?.popUpContextMenu(this.contextMenu)
      }
    })

    this.tray.on('click', () => {
      const preferenceService = application.get('PreferenceService')
      const quickAssistantEnabled = preferenceService.get('feature.quick_assistant.enabled')
      const clickTrayToShowQuickAssistant = preferenceService.get('feature.quick_assistant.click_tray_to_show')

      if (quickAssistantEnabled && clickTrayToShowQuickAssistant) {
        application.get('QuickAssistantService').showQuickWindow()
      } else {
        application.get('WindowService').showMainWindow()
      }
    })
  }

  onDeactivate(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
    this.contextMenu = null
  }

  private updateContextMenu() {
    const i18n = getI18n()
    const { tray: trayLocale, selection: selectionLocale } = i18n.translation

    const preferenceService = application.get('PreferenceService')
    const quickAssistantEnabled = preferenceService.get('feature.quick_assistant.enabled')
    const selectionAssistantEnabled = preferenceService.get('feature.selection.enabled')

    const template = [
      {
        label: trayLocale.show_window,
        click: () => application.get('WindowService').showMainWindow()
      },
      quickAssistantEnabled && {
        label: trayLocale.show_mini_window,
        click: () => application.get('QuickAssistantService').showQuickWindow()
      },
      (isWin || isMac) && {
        label: selectionLocale.name + (selectionAssistantEnabled ? ' - On' : ' - Off'),
        click: () => {
          application.get('SelectionService').toggleEnabled()
          this.updateContextMenu()
        }
      },
      { type: 'separator' },
      {
        label: trayLocale.quit,
        click: () => this.quit()
      }
    ].filter(Boolean) as MenuItemConstructorOptions[]

    this.contextMenu = Menu.buildFromTemplate(template)
  }

  private watchConfigChanges() {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('app.tray.enabled', (enabled: boolean) => {
        if (enabled) void this.activate()
        else void this.deactivate()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('app.language', () => {
        if (this.isActivated) this.updateContextMenu()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.quick_assistant.enabled', () => {
        if (this.isActivated) this.updateContextMenu()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.selection.enabled', () => {
        if (this.isActivated) this.updateContextMenu()
      })
    )
  }

  private quit() {
    application.quit()
  }
}

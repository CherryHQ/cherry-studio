import { preferenceService } from '@data/PreferenceService'
import { isLinux, isMac, isWin } from '@main/constant'
import { getI18n } from '@main/utils/language'
import type { MenuItemConstructorOptions } from 'electron'
import { app, Menu, nativeImage, nativeTheme, Tray } from 'electron'

import icon from '../../../build/tray_icon.png?asset'
import iconDark from '../../../build/tray_icon_dark.png?asset'
import iconLight from '../../../build/tray_icon_light.png?asset'
import selectionService from './SelectionService'
import { windowService } from './WindowService'
export class TrayService {
  private static instance: TrayService
  private tray: Tray | null = null
  private contextMenu: Menu | null = null

  constructor() {
    this.watchConfigChanges()
    this.updateTray()
    TrayService.instance = this
  }

  public static getInstance() {
    return TrayService.instance
  }

  private createTray() {
    this.destroyTray()

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
      const quickAssistantEnabled = preferenceService.get('feature.quick_assistant.enabled')
      const clickTrayToShowQuickAssistant = preferenceService.get('feature.quick_assistant.click_tray_to_show')

      if (quickAssistantEnabled && clickTrayToShowQuickAssistant) {
        windowService.showMiniWindow()
      } else {
        windowService.showMainWindow()
      }
    })
  }

  private updateContextMenu() {
    const i18n = getI18n()
    const { tray: trayLocale, selection: selectionLocale } = i18n.translation

    const quickAssistantEnabled = preferenceService.get('feature.quick_assistant.enabled')
    const selectionAssistantEnabled = preferenceService.get('feature.selection.enabled')

    const template = [
      {
        label: trayLocale.show_window,
        click: () => windowService.showMainWindow()
      },
      quickAssistantEnabled && {
        label: trayLocale.show_mini_window,
        click: () => windowService.showMiniWindow()
      },
      (isWin || isMac) && {
        label: selectionLocale.name + (selectionAssistantEnabled ? ' - On' : ' - Off'),
        click: () => {
          if (selectionService) {
            selectionService.toggleEnabled()
            this.updateContextMenu()
          }
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

  private updateTray() {
    const showTray = preferenceService.get('app.tray.enabled')
    if (showTray) {
      this.createTray()
    } else {
      this.destroyTray()
    }
  }

  private destroyTray() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  private watchConfigChanges() {
    preferenceService.subscribeChange('app.tray.enabled', () => this.updateTray())
    preferenceService.subscribeChange('app.language', () => this.updateContextMenu())
    preferenceService.subscribeChange('feature.quick_assistant.enabled', () => this.updateContextMenu())
    preferenceService.subscribeChange('feature.selection.enabled', () => this.updateContextMenu())
  }

  private quit() {
    app.quit()
  }
}

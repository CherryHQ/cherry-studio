import { isMac } from '@main/constant'
import { locales } from '@main/utils/locales'
import { app, Menu, MenuItemConstructorOptions, nativeImage, nativeTheme, Tray } from 'electron'

import icon from '../../../build/tray_icon.png?asset'
import iconDark from '../../../build/tray_icon_dark.png?asset'
import iconLight from '../../../build/tray_icon_light.png?asset'
import { ConfigKeys, configManager } from './ConfigManager'
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

    if (process.platform === 'win32') {
      tray.setImage(iconPath)
    } else if (process.platform === 'darwin') {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      resizedImage.setTemplateImage(true)
      tray.setImage(resizedImage)
    } else if (process.platform === 'linux') {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      tray.setImage(resizedImage)
    }

    this.tray = tray

    this.updateContextMenu()

    if (process.platform === 'linux') {
      this.tray.setContextMenu(this.contextMenu)
    }

    this.tray.setToolTip('Cherry Studio')

    this.tray.on('right-click', () => {
      if (this.contextMenu) {
        this.tray?.popUpContextMenu(this.contextMenu)
      }
    })

    this.tray.on('click', () => {
      if (configManager.getEnableQuickAssistant() && configManager.getClickTrayToShowQuickAssistant()) {
        windowService.showMiniWindow()
      } else {
        windowService.showMainWindow()
      }
    })
  }

  private updateContextMenu() {
    const locale = locales[configManager.getLanguage()]
    const { tray: trayLocale } = locale.translation

    const enableQuickAssistant = configManager.getEnableQuickAssistant()

    const template = [
      {
        label: trayLocale.show_window,
        click: () => windowService.showMainWindow()
      },
      enableQuickAssistant && {
        label: trayLocale.show_mini_window,
        click: () => windowService.showMiniWindow()
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
    const showTray = configManager.getTray()
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
    configManager.subscribe(ConfigKeys.Tray, () => this.updateTray())

    configManager.subscribe(ConfigKeys.Language, () => {
      this.updateContextMenu()
    })

    configManager.subscribe(ConfigKeys.EnableQuickAssistant, () => {
      this.updateContextMenu()
    })
  }

  private quit() {
    app.quit()
  }
}

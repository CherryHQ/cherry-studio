import { locales } from '@main/utils/locales'
import { app, Menu, nativeImage, nativeTheme, Tray } from 'electron'

import iconDark from '../../../build/tray_icon_dark.png?asset'
import iconLight from '../../../build/tray_icon_light.png?asset'
import { configManager } from './ConfigManager'
import { windowService } from './WindowService'

export class TrayService {
  private tray: Tray | null = null

  constructor() {
    this.createTray()
  }

  private createTray() {
    const iconPath = nativeTheme.shouldUseDarkColors ? iconLight : iconDark
    const tray = new Tray(iconPath)

    if (process.platform === 'win32') {
      tray.setImage(iconPath)
      nativeTheme.on('updated', () => {
        const newIconPath = nativeTheme.shouldUseDarkColors ? iconLight : iconDark
        tray.setImage(newIconPath)
      })
    } else if (process.platform === 'darwin') {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      resizedImage.setTemplateImage(true)
      tray.setImage(resizedImage)
    } else if (process.platform === 'linux') {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 24, height: 24 })
      tray.setImage(resizedImage)
      nativeTheme.on('updated', () => {
        const newIconPath = nativeTheme.shouldUseDarkColors ? iconLight : iconDark
        const newImage = nativeImage.createFromPath(newIconPath)
        const newResizedImage = newImage.resize({ width: 24, height: 24 })
        tray.setImage(newResizedImage)
      })
    }

    this.tray = tray

    const locale = locales[configManager.getLanguage()]
    const { tray: trayLocale } = locale.translation

    const contextMenu = Menu.buildFromTemplate([
      {
        label: trayLocale.show_window,
        click: () => windowService.showMainWindow()
      },
      { type: 'separator' },
      {
        label: trayLocale.quit,
        click: () => this.quit()
      }
    ])

    this.tray.setContextMenu(contextMenu)
    this.tray.setToolTip('Cherry Studio')

    this.tray.on('right-click', () => {
      this.tray?.popUpContextMenu(contextMenu)
    })

    this.tray.on('click', () => {
      windowService.showMainWindow()
    })
  }

  private quit() {
    app.quit()
  }
}

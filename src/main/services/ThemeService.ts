import { ThemeMode } from '@types'
import { configManager } from './ConfigManager'
import { nativeTheme, BrowserWindow } from 'electron'
import { titleBarOverlayDark, titleBarOverlayLight } from '../config'
import { IpcChannel } from '@shared/IpcChannel'

class ThemeService {
  private mainWindow: BrowserWindow
  private theme: ThemeMode

  constructor(mainWindow: BrowserWindow) {
    this.theme = configManager.getTheme()
    this.mainWindow = mainWindow
    nativeTheme.on('updated', this.themeUpdatadHandler.bind(this))
  }

  themeUpdatadHandler() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setTitleBarOverlay(nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight)
    }

    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send(IpcChannel.ThemeUpdated, nativeTheme.shouldUseDarkColors ? ThemeMode.dark : ThemeMode.light)
    )
  }

  setTheme(theme: ThemeMode) {
    if (theme === this.theme) {
      return
    }

    this.theme = theme
    nativeTheme.themeSource = theme === 'auto' ? 'system' : theme
    configManager.setTheme(theme)
  }
}

export default ThemeService

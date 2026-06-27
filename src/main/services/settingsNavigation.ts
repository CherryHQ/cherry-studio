import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('settingsNavigation')

export function openSettingsInMainWindow(path?: SettingsPath): void {
  const targetPath = normalizeSettingsPath(path)

  application.get('MainWindowService').showMainWindow()

  const mainWindow = application.get('WindowManager').getWindowsByType(WindowType.Main)[0]
  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendSettingsNavigation(targetPath)
    })
    return
  }

  sendSettingsNavigation(targetPath)
}

function sendSettingsNavigation(path: SettingsPath): void {
  try {
    application
      .get('WindowManager')
      .broadcastToType(WindowType.Main, IpcChannel.IpcApi_Event, 'navigation.open_settings', { path })
  } catch (error) {
    logger.error('Failed to broadcast settings navigation', error as Error)
  }
}

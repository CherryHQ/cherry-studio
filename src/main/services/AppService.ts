import { application } from '@application'
import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isWin } from '@main/core/platform'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('AppService')

export class AppService {
  public async setAppLaunchOnBoot(isLaunchOnBoot: boolean): Promise<void> {
    // Set login item settings for Windows and macOS; Linux uses an autostart desktop file.
    if (isWin || isMac) {
      app.setLoginItemSettings({ openAtLogin: isLaunchOnBoot })
    } else if (isLinux) {
      try {
        const autostartDir = application.getPath('sys.appdata.autostart')
        const desktopFile = path.join(autostartDir, isDev ? 'cherry-studio-dev.desktop' : 'cherry-studio.desktop')

        if (isLaunchOnBoot) {
          await fs.promises.mkdir(autostartDir, { recursive: true })

          // Get executable path
          let executablePath = application.getPath('app.exe_file')
          if (process.env.APPIMAGE) {
            // For AppImage packaged apps, use APPIMAGE environment variable
            executablePath = process.env.APPIMAGE
          }

          // Create desktop file content
          const desktopContent = `[Desktop Entry]
  Type=Application
  Name=Cherry Studio
  Comment=A powerful AI assistant for producer.
  Exec=${executablePath}
  Icon=cherrystudio
  Terminal=false
  StartupNotify=false
  Categories=Development;Utility;
  X-GNOME-Autostart-enabled=true
  Hidden=false`

          // Write desktop file
          await fs.promises.writeFile(desktopFile, desktopContent)
          logger.info('Created autostart desktop file for Linux')
        } else {
          try {
            await fs.promises.unlink(desktopFile)
            logger.info('Removed autostart desktop file for Linux')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
      } catch (error) {
        logger.error('Failed to set launch on boot for Linux:', error as Error)
        throw error
      }
    }
  }
}

export const appService = new AppService()

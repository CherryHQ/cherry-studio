import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { app } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import os from 'os'
import path from 'path'

export class AppService {
  private static instance: AppService

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService()
    }
    return AppService.instance
  }

  public async setAppLaunchOnBoot(isLaunchOnBoot: boolean): Promise<void> {
    // Set login item settings for windows and mac
    // linux is not supported because it requires more file operations
    if (isWin || isMac) {
      app.setLoginItemSettings({ openAtLogin: isLaunchOnBoot })
    } else if (isLinux) {
      try {
        const autostartDir = path.join(os.homedir(), '.config', 'autostart')
        const desktopFile = path.join(autostartDir, isDev ? 'cherry-studio-dev.desktop' : 'cherry-studio.desktop')

        if (isLaunchOnBoot) {
          // Ensure autostart directory exists
          try {
            await fs.promises.access(autostartDir)
          } catch {
            await fs.promises.mkdir(autostartDir, { recursive: true })
          }

          // Get executable path
          let executablePath = app.getPath('exe')
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
          log.info('Created autostart desktop file for Linux')
        } else {
          // Remove desktop file
          try {
            await fs.promises.access(desktopFile)
            await fs.promises.unlink(desktopFile)
            log.info('Removed autostart desktop file for Linux')
          } catch {
            // File doesn't exist, no need to remove
          }
        }
      } catch (error) {
        log.error('Failed to set launch on boot for Linux:', error)
      }
    }
  }
}

// Default export as singleton instance
export default AppService.getInstance()

import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { spawnSync } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

const logger = loggerService.withContext('AppService')

export interface SigningInfo {
  teamId: string | null
  bundleId: string | null
  authority: string | null
}

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

  /**
   * Get macOS app signing information (team ID, bundle ID, authority)
   * Returns null values for non-macOS platforms or unsigned apps
   */
  public getSigningInfo(): SigningInfo {
    if (!isMac) {
      return { teamId: null, bundleId: null, authority: null }
    }

    const exePath = app.getPath('exe')
    // /path/to/App.app/Contents/MacOS/AppName -> /path/to/App.app
    const appPath = exePath.replace(/\/Contents\/MacOS\/.*$/, '')

    try {
      const result = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf-8', timeout: 5000 })
      // codesign outputs signing info to stderr
      const output = result.stderr || result.stdout

      const teamIdMatch = output.match(/TeamIdentifier=(.+)/)
      const identifierMatch = output.match(/Identifier=(.+)/)
      const authorityMatch = output.match(/Authority=([^\n]+)/)

      return {
        teamId: teamIdMatch?.[1] || null,
        bundleId: identifierMatch?.[1] || null,
        authority: authorityMatch?.[1] || null
      }
    } catch (error) {
      logger.error('Failed to get signing info', error as Error)
      return { teamId: null, bundleId: null, authority: null }
    }
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
          logger.info('Created autostart desktop file for Linux')
        } else {
          // Remove desktop file
          try {
            await fs.promises.access(desktopFile)
            await fs.promises.unlink(desktopFile)
            logger.info('Removed autostart desktop file for Linux')
          } catch {
            // File doesn't exist, no need to remove
          }
        }
      } catch (error) {
        logger.error('Failed to set launch on boot for Linux:', error as Error)
      }
    }
  }
}

// Default export as singleton instance
export default AppService.getInstance()

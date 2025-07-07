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

  public setAppLaunchOnBoot(isLaunchOnBoot: boolean) {
    // Set login item settings for windows and mac
    // linux is not supported because it requires more file operations
    if (isWin || isMac) {
      app.setLoginItemSettings({ openAtLogin: isLaunchOnBoot })
    } else if (isLinux) {
      try {
        const autostartDir = path.join(os.homedir(), '.config', 'autostart')
        const desktopFile = path.join(autostartDir, isDev ? 'cherry-studio-dev.desktop' : 'cherry-studio.desktop')

        if (isLaunchOnBoot) {
          // 确保 autostart 目录存在
          if (!fs.existsSync(autostartDir)) {
            fs.mkdirSync(autostartDir, { recursive: true })
          }

          // 获取可执行文件路径
          let executablePath = app.getPath('exe')
          if (process.env.APPIMAGE) {
            // 如果是 AppImage 打包的应用，使用 APPIMAGE 环境变量
            executablePath = process.env.APPIMAGE
          }

          // 创建 desktop 文件内容
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

          // 写入 desktop 文件
          fs.writeFileSync(desktopFile, desktopContent)
          log.info('Created autostart desktop file for Linux')
        } else {
          // 删除 desktop 文件
          if (fs.existsSync(desktopFile)) {
            fs.unlinkSync(desktopFile)
            log.info('Removed autostart desktop file for Linux')
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

import { UpdateInfo } from 'builder-util-runtime'
import { app, BrowserWindow, dialog } from 'electron'
import logger from 'electron-log'
import { AppUpdater as _AppUpdater, autoUpdater } from 'electron-updater'

import icon from '../../../build/icon.png?asset'

export default class AppUpdater {
  autoUpdater: _AppUpdater = autoUpdater
  private releaseInfo: UpdateInfo | undefined

  constructor(mainWindow: BrowserWindow) {
    logger.transports.file.level = 'info'

    autoUpdater.logger = logger
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = true

    // 检测下载错误
    autoUpdater.on('error', (error) => {
      // 简单记录错误信息和时间戳
      logger.error('更新异常', {
        message: error.message,
        stack: error.stack,
        time: new Date().toISOString()
      })
      mainWindow.webContents.send('update-error', error)
    })

    autoUpdater.on('update-available', (releaseInfo: UpdateInfo) => {
      logger.info('检测到新版本', releaseInfo)
      mainWindow.webContents.send('update-available', releaseInfo)
    })

    // 检测到不需要更新时
    autoUpdater.on('update-not-available', () => {
      mainWindow.webContents.send('update-not-available')
    })

    // 更新下载进度
    autoUpdater.on('download-progress', (progress) => {
      mainWindow.webContents.send('download-progress', progress)
    })

    // 当需要更新的内容下载完成后
    autoUpdater.on('update-downloaded', (releaseInfo: UpdateInfo) => {
      mainWindow.webContents.send('update-downloaded', releaseInfo)
      this.releaseInfo = releaseInfo
      logger.info('下载完成', releaseInfo)
    })

    this.autoUpdater = autoUpdater
  }

  public async showUpdateDialog(mainWindow: BrowserWindow) {
    if (!this.releaseInfo) {
      return
    }

    dialog
      .showMessageBox({
        type: 'info',
        title: '安装更新',
        icon,
        message: `新版本 ${this.releaseInfo.version} 已准备就绪`,
        detail: this.formatReleaseNotes(this.releaseInfo.releaseNotes),
        buttons: ['稍后安装', '立即安装'],
        defaultId: 1,
        cancelId: 0
      })
      .then(({ response }) => {
        if (response === 1) {
          app.isQuitting = true
          setImmediate(() => autoUpdater.quitAndInstall())
        } else {
          mainWindow.webContents.send('update-downloaded-cancelled')
        }
      })
  }

  private formatReleaseNotes(releaseNotes: string | ReleaseNoteInfo[] | null | undefined): string {
    if (!releaseNotes) {
      return '暂无更新说明'
    }

    if (typeof releaseNotes === 'string') {
      return releaseNotes
    }

    return releaseNotes.map((note) => note.note).join('\n')
  }
}

interface ReleaseNoteInfo {
  readonly version: string
  readonly note: string | null
}

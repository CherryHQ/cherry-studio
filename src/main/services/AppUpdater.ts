import { isWin } from '@main/constant'
import { locales } from '@main/utils/locales'
import { FeedUrl } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { UpdateInfo } from 'builder-util-runtime'
import { app, BrowserWindow, dialog } from 'electron'
import logger from 'electron-log'
import { AppUpdater as _AppUpdater, autoUpdater, NsisUpdater } from 'electron-updater'
import path from 'path'

import icon from '../../../build/icon.png?asset'
import { configManager } from './ConfigManager'

export default class AppUpdater {
  autoUpdater: _AppUpdater = autoUpdater
  private releaseInfo: UpdateInfo | undefined

  constructor(mainWindow: BrowserWindow) {
    logger.transports.file.level = 'info'

    autoUpdater.logger = logger
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = configManager.getAutoUpdate()
    autoUpdater.autoInstallOnAppQuit = configManager.getAutoUpdate()
    autoUpdater.setFeedURL(configManager.getFeedUrl())

    // 检测下载错误
    autoUpdater.on('error', (error) => {
      // 简单记录错误信息和时间戳
      logger.error('更新异常', {
        message: error.message,
        stack: error.stack,
        time: new Date().toISOString()
      })
      mainWindow.webContents.send(IpcChannel.UpdateError, error)
    })

    autoUpdater.on('update-available', (releaseInfo: UpdateInfo) => {
      logger.info('检测到新版本', releaseInfo)
      mainWindow.webContents.send(IpcChannel.UpdateAvailable, releaseInfo)
    })

    // 检测到不需要更新时
    autoUpdater.on('update-not-available', () => {
      mainWindow.webContents.send(IpcChannel.UpdateNotAvailable)
    })

    // 更新下载进度
    autoUpdater.on('download-progress', (progress) => {
      mainWindow.webContents.send(IpcChannel.DownloadProgress, progress)
    })

    // 当需要更新的内容下载完成后
    autoUpdater.on('update-downloaded', (releaseInfo: UpdateInfo) => {
      mainWindow.webContents.send(IpcChannel.UpdateDownloaded, releaseInfo)
      this.releaseInfo = releaseInfo
      logger.info('下载完成', releaseInfo)
    })

    if (isWin) {
      ;(autoUpdater as NsisUpdater).installDirectory = path.dirname(app.getPath('exe'))
    }

    this.autoUpdater = autoUpdater
  }

  private async _getIpCountry() {
    try {
      // add timeout using AbortController
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const ipinfo = await fetch('https://ipinfo.io/json', {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      })

      clearTimeout(timeoutId)
      const data = await ipinfo.json()
      return data.country || 'CN'
    } catch (error) {
      logger.error('Failed to get ipinfo:', error)
      return 'CN'
    }
  }

  public setAutoUpdate(isActive: boolean) {
    autoUpdater.autoDownload = isActive
    autoUpdater.autoInstallOnAppQuit = isActive
  }

  public setFeedUrl(feedUrl: FeedUrl) {
    autoUpdater.setFeedURL(feedUrl)
    configManager.setFeedUrl(feedUrl)
  }

  public async checkForUpdates() {
    if (isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env) {
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    const ipCountry = await this._getIpCountry()
    logger.info('ipCountry', ipCountry)
    if (ipCountry !== 'CN') {
      this.autoUpdater.setFeedURL(FeedUrl.EARLY_ACCESS)
    }

    try {
      const update = await this.autoUpdater.checkForUpdates()
      if (update?.isUpdateAvailable && !this.autoUpdater.autoDownload) {
        // 如果 autoDownload 为 false，则需要再调用下面的函数触发下
        // do not use await, because it will block the return of this function
        this.autoUpdater.downloadUpdate()
      }

      return {
        currentVersion: this.autoUpdater.currentVersion,
        updateInfo: update?.updateInfo
      }
    } catch (error) {
      logger.error('Failed to check for update:', error)
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }
  }

  public async showUpdateDialog(mainWindow: BrowserWindow) {
    if (!this.releaseInfo) {
      return
    }
    const locale = locales[configManager.getLanguage()]
    const { update: updateLocale } = locale.translation

    let detail = this.formatReleaseNotes(this.releaseInfo.releaseNotes)
    if (detail === '') {
      detail = updateLocale.noReleaseNotes
    }

    dialog
      .showMessageBox({
        type: 'info',
        title: updateLocale.title,
        icon,
        message: updateLocale.message.replace('{{version}}', this.releaseInfo.version),
        detail,
        buttons: [updateLocale.later, updateLocale.install],
        defaultId: 1,
        cancelId: 0
      })
      .then(({ response }) => {
        if (response === 1) {
          app.isQuitting = true
          setImmediate(() => autoUpdater.quitAndInstall())
        } else {
          mainWindow.webContents.send(IpcChannel.UpdateDownloadedCancelled)
        }
      })
  }

  private formatReleaseNotes(releaseNotes: string | ReleaseNoteInfo[] | null | undefined): string {
    if (!releaseNotes) {
      return ''
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

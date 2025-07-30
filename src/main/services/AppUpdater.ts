import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { locales } from '@main/utils/locales'
import { generateUserAgent } from '@main/utils/systemInfo'
import { FeedUrl, UpgradeChannel } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { CancellationToken, UpdateInfo } from 'builder-util-runtime'
import { app, BrowserWindow, dialog } from 'electron'
import { AppUpdater as _AppUpdater, autoUpdater, Logger, NsisUpdater, UpdateCheckResult } from 'electron-updater'
import path from 'path'

import icon from '../../../build/icon.png?asset'
import { configManager } from './ConfigManager'

const logger = loggerService.withContext('AppUpdater')

export default class AppUpdater {
  autoUpdater: _AppUpdater = autoUpdater
  private releaseInfo: UpdateInfo | undefined
  private cancellationToken: CancellationToken = new CancellationToken()
  private updateCheckResult: UpdateCheckResult | null = null

  constructor(mainWindow: BrowserWindow) {
    autoUpdater.logger = logger as Logger
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = configManager.getAutoUpdate()
    autoUpdater.autoInstallOnAppQuit = configManager.getAutoUpdate()
    autoUpdater.requestHeaders = {
      ...autoUpdater.requestHeaders,
      'User-Agent': generateUserAgent()
    }

    autoUpdater.on('error', (error) => {
      logger.error('update error', error as Error)
      mainWindow.webContents.send(IpcChannel.UpdateError, error)
    })

    autoUpdater.on('update-available', (releaseInfo: UpdateInfo) => {
      logger.info('update available', releaseInfo)
      mainWindow.webContents.send(IpcChannel.UpdateAvailable, releaseInfo)
    })

    // 检测到不需要更新时
    autoUpdater.on('update-not-available', () => {
      if (configManager.getTestPlan() && this.autoUpdater.channel !== UpgradeChannel.LATEST) {
        logger.info('test plan is enabled, but update is not available, do not send update not available event')
        // will not send update not available event, because will check for updates with latest channel
        return
      }

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
      logger.info('update downloaded', releaseInfo)
    })

    if (isWin) {
      ;(autoUpdater as NsisUpdater).installDirectory = path.dirname(app.getPath('exe'))
    }

    this.autoUpdater = autoUpdater
  }

  private async _getPreReleaseVersionFromGithub(channel: UpgradeChannel) {
    try {
      logger.info(`get pre release version from github: ${channel}`)
      const responses = await fetch('https://api.github.com/repos/CherryHQ/cherry-studio/releases?per_page=8', {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      })
      const data = (await responses.json()) as GithubReleaseInfo[]
      const release: GithubReleaseInfo | undefined = data.find((item: GithubReleaseInfo) => {
        return item.prerelease && item.tag_name.includes(`-${channel}.`)
      })

      if (!release) {
        return null
      }

      logger.info(`prerelease url is ${release.tag_name}, set channel to ${channel}`)

      return `https://github.com/CherryHQ/cherry-studio/releases/download/${release.tag_name}`
    } catch (error) {
      logger.error('Failed to get latest not draft version from github:', error as Error)
      return null
    }
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
      logger.error('Failed to get ipinfo:', error as Error)
      return 'CN'
    }
  }

  public setAutoUpdate(isActive: boolean) {
    autoUpdater.autoDownload = isActive
    autoUpdater.autoInstallOnAppQuit = isActive
  }

  private _getChannelByVersion(version: string) {
    if (version.includes(`-${UpgradeChannel.BETA}.`)) {
      return UpgradeChannel.BETA
    }
    if (version.includes(`-${UpgradeChannel.RC}.`)) {
      return UpgradeChannel.RC
    }
    return UpgradeChannel.LATEST
  }

  private _getTestChannel() {
    const currentChannel = this._getChannelByVersion(app.getVersion())
    const savedChannel = configManager.getTestChannel()

    if (currentChannel === UpgradeChannel.LATEST) {
      return savedChannel || UpgradeChannel.RC
    }

    if (savedChannel === currentChannel) {
      return savedChannel
    }

    // if the upgrade channel is not equal to the current channel, use the latest channel
    return UpgradeChannel.LATEST
  }

  private _setChannel(channel: UpgradeChannel, feedUrl: string) {
    this.autoUpdater.channel = channel
    this.autoUpdater.setFeedURL(feedUrl)

    // disable downgrade after change the channel
    this.autoUpdater.allowDowngrade = false
    // github and gitcode don't support multiple range download
    this.autoUpdater.disableDifferentialDownload = true
  }

  private async _setFeedUrl() {
    const testPlan = configManager.getTestPlan()
    if (testPlan) {
      const channel = this._getTestChannel()

      if (channel === UpgradeChannel.LATEST) {
        this._setChannel(UpgradeChannel.LATEST, FeedUrl.GITHUB_LATEST)
        return
      }

      const preReleaseUrl = await this._getPreReleaseVersionFromGithub(channel)
      if (preReleaseUrl) {
        logger.info(`prerelease url is ${preReleaseUrl}, set channel to ${channel}`)
        this._setChannel(channel, preReleaseUrl)
        return
      }

      // if no prerelease url, use github latest to avoid error
      this._setChannel(UpgradeChannel.LATEST, FeedUrl.GITHUB_LATEST)
      return
    }

    this._setChannel(UpgradeChannel.LATEST, FeedUrl.PRODUCTION)
    const ipCountry = await this._getIpCountry()
    logger.info(`ipCountry is ${ipCountry}, set channel to ${UpgradeChannel.LATEST}`)
    if (ipCountry.toLowerCase() !== 'cn') {
      this._setChannel(UpgradeChannel.LATEST, FeedUrl.GITHUB_LATEST)
    }
  }

  public cancelDownload() {
    this.cancellationToken.cancel()
    this.cancellationToken = new CancellationToken()
    if (this.autoUpdater.autoDownload) {
      this.updateCheckResult?.cancellationToken?.cancel()
    }
  }

  public async checkForUpdates() {
    if (isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env) {
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    try {
      await this._setFeedUrl()

      this.updateCheckResult = await this.autoUpdater.checkForUpdates()
      logger.info(
        `update check result: ${this.updateCheckResult?.isUpdateAvailable}, channel: ${this.autoUpdater.channel}, currentVersion: ${this.autoUpdater.currentVersion}`
      )

      // if the update is not available, and the test plan is enabled, set the feed url to the github latest
      if (
        !this.updateCheckResult?.isUpdateAvailable &&
        configManager.getTestPlan() &&
        this.autoUpdater.channel !== UpgradeChannel.LATEST
      ) {
        logger.info('test plan is enabled, but update is not available, set channel to latest')
        this._setChannel(UpgradeChannel.LATEST, FeedUrl.GITHUB_LATEST)
        this.updateCheckResult = await this.autoUpdater.checkForUpdates()
      }

      if (this.updateCheckResult?.isUpdateAvailable && !this.autoUpdater.autoDownload) {
        // 如果 autoDownload 为 false，则需要再调用下面的函数触发下
        // do not use await, because it will block the return of this function
        logger.info('downloadUpdate manual by check for updates', this.cancellationToken)
        this.autoUpdater.downloadUpdate(this.cancellationToken)
      }

      return {
        currentVersion: this.autoUpdater.currentVersion,
        updateInfo: this.updateCheckResult?.isUpdateAvailable ? this.updateCheckResult?.updateInfo : null
      }
    } catch (error) {
      logger.error('Failed to check for update:', error as Error)
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
interface GithubReleaseInfo {
  draft: boolean
  prerelease: boolean
  tag_name: string
}
interface ReleaseNoteInfo {
  readonly version: string
  readonly note: string | null
}

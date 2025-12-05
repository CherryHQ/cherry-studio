import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { getIpCountry } from '@main/utils/ipService'
import { generateUserAgent } from '@main/utils/systemInfo'
import { FeedUrl, UpdateConfigUrl, UpdateMirror, UpgradeChannel } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import type { UpdateInfo } from 'builder-util-runtime'
import { app, net } from 'electron'
import type { AppUpdater as _AppUpdater, Logger, NsisUpdater, UpdateCheckResult } from 'electron-updater'
import { CancellationToken } from 'electron-updater'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import semver from 'semver'

import { configManager } from './ConfigManager'
import { windowService } from './WindowService'

const logger = loggerService.withContext('AppUpdater')

// Language markers constants for multi-language release notes
const LANG_MARKERS = {
  EN_START: '<!--LANG:en-->',
  ZH_CN_START: '<!--LANG:zh-CN-->',
  END: '<!--LANG:END-->'
}

interface UpdateConfig {
  lastUpdated: string
  versions: {
    [versionKey: string]: VersionConfig
  }
}

interface VersionConfig {
  minCompatibleVersion: string
  description: string
  channels: {
    latest: ChannelConfig | null
    rc: ChannelConfig | null
    beta: ChannelConfig | null
  }
}

interface ChannelConfig {
  version: string
  feedUrls: Record<UpdateMirror, string>
}

export default class AppUpdater {
  autoUpdater: _AppUpdater = autoUpdater
  private cancellationToken: CancellationToken = new CancellationToken()
  private updateCheckResult: UpdateCheckResult | null = null

  constructor() {
    autoUpdater.logger = logger as Logger
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = configManager.getAutoUpdate()
    autoUpdater.autoInstallOnAppQuit = configManager.getAutoUpdate()
    autoUpdater.requestHeaders = {
      ...autoUpdater.requestHeaders,
      'User-Agent': generateUserAgent(),
      'X-Client-Id': configManager.getClientId(),
      // no-cache
      'Cache-Control': 'no-cache'
    }

    autoUpdater.on('error', (error) => {
      logger.error('update error', error as Error)
      windowService.getMainWindow()?.webContents.send(IpcChannel.UpdateError, error)
    })

    autoUpdater.on('update-available', (releaseInfo: UpdateInfo) => {
      logger.info('update available', releaseInfo)
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      windowService.getMainWindow()?.webContents.send(IpcChannel.UpdateAvailable, processedReleaseInfo)
    })

    // 检测到不需要更新时
    autoUpdater.on('update-not-available', () => {
      windowService.getMainWindow()?.webContents.send(IpcChannel.UpdateNotAvailable)
    })

    // 更新下载进度
    autoUpdater.on('download-progress', (progress) => {
      windowService.getMainWindow()?.webContents.send(IpcChannel.DownloadProgress, progress)
    })

    // 当需要更新的内容下载完成后
    autoUpdater.on('update-downloaded', (releaseInfo: UpdateInfo) => {
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      windowService.getMainWindow()?.webContents.send(IpcChannel.UpdateDownloaded, processedReleaseInfo)
      logger.info('update downloaded', processedReleaseInfo)
    })

    if (isWin) {
      ;(autoUpdater as NsisUpdater).installDirectory = path.dirname(app.getPath('exe'))
    }

    this.autoUpdater = autoUpdater
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

  /**
   * Fetch update configuration from GitHub or GitCode based on mirror
   * @param mirror - Mirror to fetch config from
   * @returns UpdateConfig object or null if fetch fails
   */
  private async _fetchUpdateConfig(mirror: UpdateMirror): Promise<UpdateConfig | null> {
    const configUrl = mirror === UpdateMirror.GITCODE ? UpdateConfigUrl.GITCODE : UpdateConfigUrl.GITHUB

    try {
      logger.info(`Fetching update config from ${configUrl} (mirror: ${mirror})`)
      const response = await net.fetch(configUrl, {
        headers: {
          'User-Agent': generateUserAgent(),
          Accept: 'application/json',
          'X-Client-Id': configManager.getClientId(),
          // no-cache
          'Cache-Control': 'no-cache'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const config = (await response.json()) as UpdateConfig
      logger.info(`Update config fetched successfully, last updated: ${config.lastUpdated}`)
      return config
    } catch (error) {
      logger.error('Failed to fetch update config:', error as Error)
      return null
    }
  }

  /**
   * Find compatible channel configuration based on current version
   * @param currentVersion - Current app version
   * @param requestedChannel - Requested upgrade channel (latest/rc/beta)
   * @param config - Update configuration object
   * @returns Object containing ChannelConfig and actual channel if found, null otherwise
   */
  private _findCompatibleChannel(
    currentVersion: string,
    requestedChannel: UpgradeChannel,
    config: UpdateConfig
  ): { config: ChannelConfig; channel: UpgradeChannel } | null {
    // Get all version keys and sort descending (newest first)
    const versionKeys = Object.keys(config.versions).sort(semver.rcompare)

    logger.info(
      `Finding compatible channel for version ${currentVersion}, requested channel: ${requestedChannel}, available versions: ${versionKeys.join(', ')}`
    )

    for (const versionKey of versionKeys) {
      const versionConfig = config.versions[versionKey]
      const channelConfig = versionConfig.channels[requestedChannel]
      const latestChannelConfig = versionConfig.channels[UpgradeChannel.LATEST]

      // Check version compatibility and channel availability
      if (semver.gte(currentVersion, versionConfig.minCompatibleVersion) && channelConfig !== null) {
        logger.info(
          `Found compatible version: ${versionKey} (minCompatibleVersion: ${versionConfig.minCompatibleVersion}), version: ${channelConfig.version}`
        )

        if (
          requestedChannel !== UpgradeChannel.LATEST &&
          latestChannelConfig &&
          semver.gte(latestChannelConfig.version, channelConfig.version)
        ) {
          logger.info(
            `latest channel version is greater than the requested channel version: ${latestChannelConfig.version} > ${channelConfig.version}, using latest instead`
          )
          return { config: latestChannelConfig, channel: UpgradeChannel.LATEST }
        }

        return { config: channelConfig, channel: requestedChannel }
      }
    }

    logger.warn(`No compatible channel found for version ${currentVersion} and channel ${requestedChannel}`)
    return null
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
    const currentVersion = app.getVersion()
    const testPlan = configManager.getTestPlan()
    const requestedChannel = testPlan ? this._getTestChannel() : UpgradeChannel.LATEST

    // Determine mirror based on IP country
    const ipCountry = await getIpCountry()
    const mirror = ipCountry.toLowerCase() === 'cn' ? UpdateMirror.GITCODE : UpdateMirror.GITHUB

    logger.info(
      `Setting feed URL for version ${currentVersion}, testPlan: ${testPlan}, requested channel: ${requestedChannel}, mirror: ${mirror} (IP country: ${ipCountry})`
    )

    // Try to fetch update config from remote
    const config = await this._fetchUpdateConfig(mirror)

    if (config) {
      // Use new config-based system
      const result = this._findCompatibleChannel(currentVersion, requestedChannel, config)

      if (result) {
        const { config: channelConfig, channel: actualChannel } = result
        const feedUrl = channelConfig.feedUrls[mirror]
        logger.info(
          `Using config-based feed URL: ${feedUrl} for channel ${actualChannel} (requested: ${requestedChannel}, mirror: ${mirror})`
        )
        this._setChannel(actualChannel, feedUrl)
        return
      }
    }

    logger.info('Failed to fetch update config, falling back to default feed URL')
    // Fallback: use default feed URL based on mirror
    const defaultFeedUrl = mirror === UpdateMirror.GITCODE ? FeedUrl.PRODUCTION : FeedUrl.GITHUB_LATEST

    logger.info(`Using fallback feed URL: ${defaultFeedUrl}`)
    this._setChannel(UpgradeChannel.LATEST, defaultFeedUrl)
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

  public quitAndInstall() {
    app.isQuitting = true
    setImmediate(() => autoUpdater.quitAndInstall())
  }

  /**
   * Check if release notes contain multi-language markers
   */
  private hasMultiLanguageMarkers(releaseNotes: string): boolean {
    return releaseNotes.includes(LANG_MARKERS.EN_START)
  }

  /**
   * Parse multi-language release notes and return the appropriate language version
   * @param releaseNotes - Release notes string with language markers
   * @returns Parsed release notes for the user's language
   *
   * Expected format:
   * <!--LANG:en-->English content<!--LANG:zh-CN-->Chinese content<!--LANG:END-->
   */
  private parseMultiLangReleaseNotes(releaseNotes: string): string {
    try {
      const language = configManager.getLanguage()
      const isChineseUser = language === 'zh-CN' || language === 'zh-TW'

      // Create regex patterns using constants
      const enPattern = new RegExp(
        `${LANG_MARKERS.EN_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${LANG_MARKERS.ZH_CN_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      )
      const zhPattern = new RegExp(
        `${LANG_MARKERS.ZH_CN_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${LANG_MARKERS.END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      )

      // Extract language sections
      const enMatch = releaseNotes.match(enPattern)
      const zhMatch = releaseNotes.match(zhPattern)

      // Return appropriate language version with proper fallback
      if (isChineseUser && zhMatch) {
        return zhMatch[1].trim()
      } else if (enMatch) {
        return enMatch[1].trim()
      } else {
        // Clean fallback: remove all language markers
        logger.warn('Failed to extract language-specific release notes, using cleaned fallback')
        return releaseNotes
          .replace(new RegExp(`${LANG_MARKERS.EN_START}|${LANG_MARKERS.ZH_CN_START}|${LANG_MARKERS.END}`, 'g'), '')
          .trim()
      }
    } catch (error) {
      logger.error('Failed to parse multi-language release notes', error as Error)
      // Return original notes as safe fallback
      return releaseNotes
    }
  }

  /**
   * Process release info to handle multi-language release notes
   * @param releaseInfo - Original release info from updater
   * @returns Processed release info with localized release notes
   */
  private processReleaseInfo(releaseInfo: UpdateInfo): UpdateInfo {
    const processedInfo = { ...releaseInfo }

    // Handle multi-language release notes in string format
    if (releaseInfo.releaseNotes && typeof releaseInfo.releaseNotes === 'string') {
      // Check if it contains multi-language markers
      if (this.hasMultiLanguageMarkers(releaseInfo.releaseNotes)) {
        processedInfo.releaseNotes = this.parseMultiLangReleaseNotes(releaseInfo.releaseNotes)
      }
    }

    return processedInfo
  }
}

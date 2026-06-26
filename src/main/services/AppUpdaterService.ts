import { application } from '@application'
import { loggerService } from '@logger'
import { computeBackoff } from '@main/core/job/runtime/backoff'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { regionService } from '@main/services/RegionService'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import type { RetryPolicy } from '@shared/data/api/schemas/jobs'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { APP_NAME } from '@shared/utils/constants'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { CancellationToken } from 'builder-util-runtime'
import { app, net } from 'electron'
import type { Logger, NsisUpdater, UpdateCheckResult } from 'electron-updater'
import { autoUpdater } from 'electron-updater'
import semver from 'semver'

const logger = loggerService.withContext('AppUpdaterService')

export enum FeedUrl {
  PRODUCTION = 'https://releases.cherry-ai.com',
  GITHUB_LATEST = 'https://github.com/CherryHQ/cherry-studio/releases/latest/download'
}

export enum UpdateConfigUrl {
  GITHUB = 'https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/x-files/app-upgrade-config/app-upgrade-config.json',
  GITCODE = 'https://raw.gitcode.com/CherryHQ/cherry-studio/raw/x-files%2Fapp-upgrade-config/app-upgrade-config.json'
}

export enum UpdateMirror {
  GITHUB = 'github',
  GITCODE = 'gitcode'
}

function getCommonHeaders() {
  return {
    'User-Agent': generateUserAgent(),
    'Cache-Control': 'no-cache',
    'Client-Id': getClientId(),
    'App-Name': APP_NAME,
    'App-Version': `v${app.getVersion()}`,
    OS: process.platform
  }
}

// Language markers constants for multi-language release notes
const LANG_MARKERS = {
  EN_START: '<!--LANG:en-->',
  ZH_CN_START: '<!--LANG:zh-CN-->',
  END: '<!--LANG:END-->'
}

// Auto update-check scheduling. The cadence lives in the main process (this
// service), not the renderer, so it survives window close and runs exactly
// once regardless of how many windows are open.
const AUTO_UPDATE_SCHEDULE_ID = 'app-updater:auto-check'
// Base interval between automatic checks.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
// ± ratio of random jitter applied per cycle, so clients that launched around
// the same time don't all hit the update server on the same beat.
const CHECK_JITTER_RATIO = 0.15
// Short delay before the first check after startup, letting boot I/O settle.
const INITIAL_CHECK_DELAY_MS = 5_000
// Backoff for consecutive check failures: 5/10/20/40min, capped at 60min — always
// shorter than the normal cadence so a transient failure recovers sooner. Note
// `computeBackoff` ignores `maxAttempts`; auto-check never gives up, so it is a
// placeholder only to satisfy RetryPolicy's strictObject shape.
const CHECK_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoff: 'exponential',
  baseDelayMs: 5 * 60 * 1000,
  maxDelayMs: 60 * 60 * 1000
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

@Injectable('AppUpdaterService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'SchedulerService'])
export class AppUpdaterService extends BaseService {
  private cancellationToken: CancellationToken = new CancellationToken()
  private updateCheckResult: UpdateCheckResult | null = null
  // Consecutive scheduled-check failures, drives backoff; reset on success.
  private updateCheckFailures = 0

  protected async onInit(): Promise<void> {
    autoUpdater.logger = logger as Logger
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = application.get('PreferenceService').get('app.dist.auto_update.enabled')
    // Never auto-install on quit - user must explicitly click "Install Now"
    // Auto-install on quit can cause issues: unexpected updates on restart,
    // corruption if system shuts down during install, or app uninstall on force shutdown
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.requestHeaders = {
      ...autoUpdater.requestHeaders,
      ...getCommonHeaders()
    }

    this.registerAutoUpdaterListeners()

    if (isWin) {
      ;(autoUpdater as NsisUpdater).installDirectory = application.getPath('app.install')
    }

    // Cancel an in-flight download when the test plan or channel changes — the
    // download targets the previously selected channel. The v2 settings UI
    // writes these preferences directly (no IPC), so react to the change here
    // rather than in a now-removed `App_SetTestPlan`/`App_SetTestChannel` handler.
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges(['app.dist.test_plan.enabled', 'app.dist.test_plan.channel'], () =>
          this.cancelDownload()
        )
    )

    // Stop the scheduled check when this service stops (it depends on
    // SchedulerService, so SchedulerService is still alive at this point).
    this.registerDisposable(() => application.get('SchedulerService').unregister(AUTO_UPDATE_SCHEDULE_ID))
  }

  protected async onAllReady(): Promise<void> {
    application.get('PowerService').registerShutdownHandler(() => {
      this.setAutoUpdate(false)
    })

    // Dev builds and portable builds never auto-update; the manual "check for
    // update" button still works in those cases.
    if (!app.isPackaged || this.isPortable()) {
      return
    }
    this.scheduleNextUpdateCheck(INITIAL_CHECK_DELAY_MS)
  }

  private registerAutoUpdaterListeners(): void {
    const wm = () => application.get('WindowManager')
    const onError = (error: Error) => {
      logger.error('update error', error)
      wm().broadcastToType(WindowType.Main, IpcChannel.UpdateError, error)
    }
    autoUpdater.on('error', onError)
    this.registerDisposable(() => autoUpdater.removeListener('error', onError))

    const onUpdateAvailable = (releaseInfo: UpdateInfo) => {
      logger.info('update available', releaseInfo)
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      wm().broadcastToType(WindowType.Main, IpcChannel.UpdateAvailable, processedReleaseInfo)
    }
    autoUpdater.on('update-available', onUpdateAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-available', onUpdateAvailable))

    const onUpdateNotAvailable = () => {
      wm().broadcastToType(WindowType.Main, IpcChannel.UpdateNotAvailable)
    }
    autoUpdater.on('update-not-available', onUpdateNotAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-not-available', onUpdateNotAvailable))

    const onDownloadProgress = (progress: ProgressInfo) => {
      wm().broadcastToType(WindowType.Main, IpcChannel.DownloadProgress, progress)
    }
    autoUpdater.on('download-progress', onDownloadProgress)
    this.registerDisposable(() => autoUpdater.removeListener('download-progress', onDownloadProgress))

    const onUpdateDownloaded = (releaseInfo: UpdateInfo) => {
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      wm().broadcastToType(WindowType.Main, IpcChannel.UpdateDownloaded, processedReleaseInfo)
      logger.info('update downloaded', processedReleaseInfo)
    }
    autoUpdater.on('update-downloaded', onUpdateDownloaded)
    this.registerDisposable(() => autoUpdater.removeListener('update-downloaded', onUpdateDownloaded))
  }

  public setAutoUpdate(isActive: boolean) {
    autoUpdater.autoDownload = isActive
    // autoInstallOnAppQuit is always false - user must explicitly click "Install Now"
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
    const savedChannel = application.get('PreferenceService').get('app.dist.test_plan.channel')

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
          ...getCommonHeaders(),
          Accept: 'application/json'
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

      if (!semver.gte(currentVersion, versionConfig.minCompatibleVersion)) {
        continue
      }

      // Check version compatibility and channel availability
      if (channelConfig !== null) {
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
      } else if (requestedChannel !== UpgradeChannel.LATEST && latestChannelConfig !== null) {
        // Fallback: requested channel (rc/beta) is null, but latest channel is available
        logger.info(
          `Requested channel ${requestedChannel} is null for ${versionKey}, falling back to latest channel: ${latestChannelConfig.version}`
        )
        return { config: latestChannelConfig, channel: UpgradeChannel.LATEST }
      }
    }

    logger.warn(`No compatible channel found for version ${currentVersion} and channel ${requestedChannel}`)
    return null
  }

  private _setChannel(channel: UpgradeChannel, feedUrl: string) {
    autoUpdater.channel = channel
    autoUpdater.setFeedURL(feedUrl)

    // disable downgrade after change the channel
    autoUpdater.allowDowngrade = false
    // github and gitcode don't support multiple range download
    autoUpdater.disableDifferentialDownload = true
  }

  private async _setFeedUrl() {
    const currentVersion = app.getVersion()
    const testPlan = application.get('PreferenceService').get('app.dist.test_plan.enabled')
    const requestedChannel = testPlan ? this._getTestChannel() : UpgradeChannel.LATEST

    // Determine mirror based on IP country
    const ipCountry = await regionService.getCountry()
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
    if (autoUpdater.autoDownload) {
      this.updateCheckResult?.cancellationToken?.cancel()
    }
  }

  private isPortable(): boolean {
    return isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env
  }

  /**
   * Throwing core of the update check: feed-url setup → check → (manual) download
   * trigger. A check/network failure REJECTS so callers that need a failure
   * signal — the scheduler's backoff — can observe it. The public IPC entry
   * `checkForUpdates()` wraps this and swallows the error to preserve its
   * event-driven contract: errors reach the renderer via the `UpdateError`
   * broadcast (see `registerAutoUpdaterListeners`), not the return value.
   */
  private async _runUpdateCheck() {
    void application.get('AnalyticsService').trackAppUpdate()

    if (this.isPortable()) {
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    await this._setFeedUrl()

    this.updateCheckResult = await autoUpdater.checkForUpdates()
    logger.info(
      `update check result: ${this.updateCheckResult?.isUpdateAvailable}, channel: ${autoUpdater.channel}, currentVersion: ${autoUpdater.currentVersion}`
    )

    if (this.updateCheckResult?.isUpdateAvailable && !autoUpdater.autoDownload) {
      // 如果 autoDownload 为 false，则需要再调用下面的函数触发下
      // do not use await, because it will block the return of this function
      logger.info('downloadUpdate manual by check for updates', this.cancellationToken)
      void autoUpdater.downloadUpdate(this.cancellationToken)
    }

    return {
      currentVersion: autoUpdater.currentVersion,
      updateInfo: this.updateCheckResult?.isUpdateAvailable ? this.updateCheckResult?.updateInfo : null
    }
  }

  public async checkForUpdates() {
    try {
      return await this._runUpdateCheck()
    } catch (error) {
      logger.error('Failed to check for update:', error as Error)
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }
  }

  /**
   * Arm the next automatic check on SchedulerService as a one-shot `delayMs`
   * from now. Re-registering the same id replaces the prior timer, so the
   * callback re-arming itself with a freshly computed delay (jitter on success,
   * backoff on failure) forms the recurring loop. The returned Disposable is
   * discarded; cleanup is the single `unregister` registered in `onInit`.
   */
  private scheduleNextUpdateCheck(delayMs: number): void {
    application
      .get('SchedulerService')
      .registerSchedule(AUTO_UPDATE_SCHEDULE_ID, { kind: 'once', at: Date.now() + delayMs }, () =>
        this.runScheduledUpdateCheck()
      )
  }

  private async runScheduledUpdateCheck(): Promise<void> {
    try {
      // Gate per tick rather than subscribing to the preference: when disabled
      // the loop keeps ticking (harmless no-op) and resumes automatically once
      // re-enabled. Only the detection failure of `_runUpdateCheck` drives
      // backoff — the manual download trigger is fire-and-forget and surfaces
      // its own errors via the `UpdateError` event.
      if (application.get('PreferenceService').get('app.dist.auto_update.enabled')) {
        await this._runUpdateCheck()
      }
      this.updateCheckFailures = 0
      this.scheduleNextUpdateCheck(this.nextUpdateCheckDelayMs())
    } catch {
      this.updateCheckFailures++
      const backoffMs = computeBackoff(CHECK_RETRY_POLICY, this.updateCheckFailures)
      logger.warn(`scheduled update check failed, backing off for ${backoffMs}ms`)
      this.scheduleNextUpdateCheck(backoffMs)
    }
  }

  private nextUpdateCheckDelayMs(): number {
    return Math.round(CHECK_INTERVAL_MS * (1 + (Math.random() * 2 - 1) * CHECK_JITTER_RATIO))
  }

  public quitAndInstall() {
    application.markQuitting()
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
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
      const language = application.get('PreferenceService').get('app.language')
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

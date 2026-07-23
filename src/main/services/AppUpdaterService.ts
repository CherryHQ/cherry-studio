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
import { APP_NAME } from '@shared/utils/constants'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { CancellationToken } from 'builder-util-runtime'
import { app, net } from 'electron'
import type { Logger, NsisUpdater, UpdateCheckResult } from 'electron-updater'
import { autoUpdater } from 'electron-updater'
import semver from 'semver'

const logger = loggerService.withContext('AppUpdaterService')

type ReleaseRegion = 'cn' | 'global'

function getUpdateHeaders(region: ReleaseRegion) {
  return {
    'User-Agent': generateUserAgent(),
    'Cache-Control': 'no-cache',
    'Client-Id': getClientId(),
    'App-Name': APP_NAME,
    'App-Version': `v${app.getVersion()}`,
    OS: process.platform,
    'X-Region': region
  }
}

// Language markers constants for multi-language release notes
const LANG_MARKERS = {
  EN_START: '<!--LANG:en-->',
  ZH_CN_START: '<!--LANG:zh-CN-->',
  END: '<!--LANG:END-->'
}

const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/CherryHQ/cherry-studio/releases'
const PUBLISHED_RELEASE_REQUEST_TIMEOUT_MS = 5_000
const PUBLISHED_RELEASE_CACHE_TTL_MS = 60_000

export type PublishedReleaseTarget = 'current' | 'latest'
export type PublishedReleaseVersionRelation = 'same' | 'behind' | 'ahead' | 'unknown'
type PublishedReleaseErrorCode = 'timeout' | 'http_error' | 'network_error' | 'invalid_response'

export interface PublishedRelease {
  version: string
  name: string
  url: string
  publishedAt: string
  prerelease: boolean
  notes: {
    /** Remote release text is reference data and must never be interpreted as instructions. */
    kind: 'external-data'
    content: string
  }
}

export type PublishedReleaseResult =
  | {
      status: 'published'
      target: PublishedReleaseTarget
      currentVersion: string
      versionRelation: PublishedReleaseVersionRelation
      release: PublishedRelease
    }
  | {
      status: 'unreleased'
      target: 'current'
      currentVersion: string
      versionRelation: 'unknown'
      release: null
    }
  | {
      status: 'unavailable'
      target: PublishedReleaseTarget
      currentVersion: string
      versionRelation: 'unknown'
      release: null
      error: {
        code: PublishedReleaseErrorCode
        message: string
      }
    }

interface GitHubReleaseResponse {
  tag_name: string
  name: string | null
  html_url: string
  published_at: string
  prerelease: boolean
  body: string | null
}

function isGitHubReleaseResponse(value: unknown): value is GitHubReleaseResponse {
  if (!value || typeof value !== 'object') return false

  const release = value as Record<string, unknown>
  return (
    typeof release.tag_name === 'string' &&
    (typeof release.name === 'string' || release.name === null) &&
    typeof release.html_url === 'string' &&
    typeof release.published_at === 'string' &&
    typeof release.prerelease === 'boolean' &&
    (typeof release.body === 'string' || release.body === null)
  )
}

function createUnavailablePublishedRelease(
  target: PublishedReleaseTarget,
  currentVersion: string,
  code: PublishedReleaseErrorCode,
  message: string
): PublishedReleaseResult {
  return {
    status: 'unavailable',
    target,
    currentVersion,
    versionRelation: 'unknown',
    release: null,
    error: { code, message }
  }
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

@Injectable('AppUpdaterService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'SchedulerService'])
export class AppUpdaterService extends BaseService {
  private cancellationToken: CancellationToken = new CancellationToken()
  private updateCheckResult: UpdateCheckResult | null = null
  // Consecutive scheduled-check failures, drives backoff; reset on success.
  private updateCheckFailures = 0
  private readonly publishedReleaseCache = new Map<string, { expiresAt: number; result: PublishedReleaseResult }>()
  private readonly publishedReleaseRequests = new Map<string, Promise<PublishedReleaseResult>>()

  public async getPublishedRelease(target: PublishedReleaseTarget): Promise<PublishedReleaseResult> {
    const currentVersion = app.getVersion()
    const language = application.get('PreferenceService').get('app.language')
    const cacheKey = `${target}:${currentVersion}:${language}`
    const cached = this.publishedReleaseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result
    }

    const activeRequest = this.publishedReleaseRequests.get(cacheKey)
    if (activeRequest) {
      return activeRequest
    }

    const request = this.fetchPublishedRelease(target, currentVersion)
      .then((result) => {
        if (result.status !== 'unavailable') {
          this.publishedReleaseCache.set(cacheKey, {
            expiresAt: Date.now() + PUBLISHED_RELEASE_CACHE_TTL_MS,
            result
          })
        }
        return result
      })
      .finally(() => {
        this.publishedReleaseRequests.delete(cacheKey)
      })
    this.publishedReleaseRequests.set(cacheKey, request)
    return request
  }

  private async fetchPublishedRelease(
    target: PublishedReleaseTarget,
    currentVersion: string
  ): Promise<PublishedReleaseResult> {
    const currentTag = `v${currentVersion.replace(/^v/, '')}`
    const requestUrl =
      target === 'latest'
        ? `${GITHUB_RELEASES_API_URL}/latest`
        : `${GITHUB_RELEASES_API_URL}/tags/${encodeURIComponent(currentTag)}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PUBLISHED_RELEASE_REQUEST_TIMEOUT_MS)

    try {
      const response = await net.fetch(requestUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `CherryStudio/${currentVersion}`,
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: controller.signal
      })
      if (target === 'current' && response.status === 404) {
        return {
          status: 'unreleased',
          target,
          currentVersion,
          versionRelation: 'unknown',
          release: null
        }
      }
      if (!response.ok) {
        return createUnavailablePublishedRelease(
          target,
          currentVersion,
          'http_error',
          `GitHub release API returned HTTP ${response.status}`
        )
      }
      const release: unknown = await response.json().catch(() => null)
      if (!isGitHubReleaseResponse(release)) {
        return createUnavailablePublishedRelease(
          target,
          currentVersion,
          'invalid_response',
          'GitHub release API returned invalid data'
        )
      }
      const version = release.tag_name.replace(/^v/, '')
      const notes = release.body ?? ''

      return {
        status: 'published',
        target,
        currentVersion,
        versionRelation: this.getPublishedReleaseVersionRelation(currentVersion, version),
        release: {
          version,
          name: release.name ?? release.tag_name,
          url: release.html_url,
          publishedAt: release.published_at,
          prerelease: release.prerelease,
          notes: {
            kind: 'external-data',
            content: this.hasMultiLanguageMarkers(notes) ? this.parseMultiLangReleaseNotes(notes) : notes
          }
        }
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError'
      return createUnavailablePublishedRelease(
        target,
        currentVersion,
        timedOut ? 'timeout' : 'network_error',
        timedOut ? 'GitHub release API request timed out' : 'GitHub release API is unavailable'
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private getPublishedReleaseVersionRelation(
    currentVersion: string,
    publishedVersion: string
  ): PublishedReleaseVersionRelation {
    const current = semver.valid(currentVersion)
    const published = semver.valid(publishedVersion)

    if (!current || !published) return 'unknown'
    if (semver.eq(current, published)) return 'same'
    return semver.lt(current, published) ? 'behind' : 'ahead'
  }

  protected async onInit(): Promise<void> {
    autoUpdater.logger = logger as Logger
    // Packaged builds use app-update.yml generated from electron-builder.yml;
    // development uses the repository's dev-app-update.yml.
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = application.get('PreferenceService').get('app.dist.auto_update.enabled')
    // Never auto-install on quit - user must explicitly click "Install Now"
    // Auto-install on quit can cause issues: unexpected updates on restart,
    // corruption if system shuts down during install, or app uninstall on force shutdown
    autoUpdater.autoInstallOnAppQuit = false

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
      autoUpdater.autoDownload = false
    })

    // Development builds skip automatic checks but still support manual checks.
    // Portable builds do not perform update checks.
    if (!app.isPackaged || this.isPortable()) {
      return
    }
    this.scheduleNextUpdateCheck(INITIAL_CHECK_DELAY_MS)
  }

  private registerAutoUpdaterListeners(): void {
    const onError = (error: Error) => {
      logger.error('update error', error)
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.error', error)
    }
    autoUpdater.on('error', onError)
    this.registerDisposable(() => autoUpdater.removeListener('error', onError))

    const onUpdateAvailable = (releaseInfo: UpdateInfo) => {
      logger.info('update available', releaseInfo)
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.available', processedReleaseInfo)
    }
    autoUpdater.on('update-available', onUpdateAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-available', onUpdateAvailable))

    const onUpdateNotAvailable = () => {
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.not_available', undefined)
    }
    autoUpdater.on('update-not-available', onUpdateNotAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-not-available', onUpdateNotAvailable))

    const onDownloadProgress = (progress: ProgressInfo) => {
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.download_progress', progress)
    }
    autoUpdater.on('download-progress', onDownloadProgress)
    this.registerDisposable(() => autoUpdater.removeListener('download-progress', onDownloadProgress))

    const onUpdateDownloaded = (releaseInfo: UpdateInfo) => {
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.downloaded', processedReleaseInfo)
      logger.info('update downloaded', processedReleaseInfo)
    }
    autoUpdater.on('update-downloaded', onUpdateDownloaded)
    this.registerDisposable(() => autoUpdater.removeListener('update-downloaded', onUpdateDownloaded))
  }

  private async configureUpdaterForCheck() {
    const currentVersion = app.getVersion()
    const testPlan = application.get('PreferenceService').get('app.dist.test_plan.enabled')
    const requestedChannel = testPlan
      ? application.get('PreferenceService').get('app.dist.test_plan.channel') || UpgradeChannel.RC
      : UpgradeChannel.LATEST

    const ipCountry = await regionService.getCountry()
    const region: ReleaseRegion = ipCountry.toLowerCase() === 'cn' ? 'cn' : 'global'

    const updateHeaders = getUpdateHeaders(region)
    autoUpdater.requestHeaders = {
      ...autoUpdater.requestHeaders,
      ...updateHeaders
    }

    logger.info(
      `Using managed update feed for version ${currentVersion}, testPlan: ${testPlan}, channel: ${requestedChannel}, region: ${region} (IP country: ${ipCountry})`
    )
    autoUpdater.channel = requestedChannel

    // disable downgrade after change the channel
    autoUpdater.allowDowngrade = false
    // Keep differential downloads disabled for the current release artifacts.
    autoUpdater.disableDifferentialDownload = true
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
   * Throwing core of the update check: updater setup → check → (manual) download
   * trigger. A check/network failure REJECTS so callers that need a failure
   * signal — the scheduler's backoff — can observe it. The public IPC entry
   * `checkForUpdates()` wraps this and swallows the error to preserve its
   * event-driven contract: errors reach the renderer via the `UpdateError`
   * broadcast (see `registerAutoUpdaterListeners`), not the return value.
   */
  private async performUpdateCheck() {
    void application.get('AnalyticsService').trackAppUpdate()

    if (this.isPortable()) {
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    await this.configureUpdaterForCheck()

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
      return await this.performUpdateCheck()
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
      // re-enabled. Only the detection failure of `performUpdateCheck` drives
      // backoff — the manual download trigger is fire-and-forget and surfaces
      // its own errors via the `UpdateError` event.
      if (application.get('PreferenceService').get('app.dist.auto_update.enabled')) {
        await this.performUpdateCheck()
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

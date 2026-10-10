import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'

import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { CancellationToken } from 'builder-util-runtime'
import { app, net } from 'electron'
import type { Logger, NsisUpdater, UpdateCheckResult } from 'electron-updater'
import { AppUpdater, autoUpdater } from 'electron-updater'

import { application } from '@application'
import { loggerService } from '@logger'
import { computeBackoff } from '@main/core/job/runtime/backoff'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { regionService } from '@main/services/RegionService'
import { getAppEdition } from '@main/utils/appEdition'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import type { RetryPolicy } from '@shared/data/api/schemas/jobs'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { UpdateRelease, UpdateSnapshot } from '@shared/ipc/schemas/updater'
import type { AppEdition } from '@shared/types/appEdition'
import type { SupportedPlatform } from '@shared/types/command'
import { APP_NAME } from '@shared/utils/constants'
import {
  hasMultiLanguageReleaseNotes,
  localizeReleaseNotes,
  mergeReleaseHistory,
  parseReleaseHistory,
  type ReleaseNotesEntry
} from '@shared/utils/releaseNotes'

import type { VelopackBackend } from './appUpdater/velopackBackend'

const logger = loggerService.withContext('AppUpdaterService')

type ReleaseRegion = 'cn' | 'global'

export const RELEASE_HISTORY_URL = 'https://releases.cherry-ai.com/release-history.json'
const RELEASE_HISTORY_TIMEOUT_MS = 10_000
const RELEASE_HISTORY_MAX_BYTES = 1024 * 1024

function getEditionUpdateChannel(channel: UpgradeChannel, edition: AppEdition): string {
  return edition === 'cn' ? `${channel}-cn` : channel
}

function getUpdateHeaders({ region, edition }: { region: ReleaseRegion; edition: AppEdition }) {
  return {
    'User-Agent': generateUserAgent(),
    'Cache-Control': 'no-cache',
    'Client-Id': getClientId(),
    'App-Name': APP_NAME,
    'App-Version': `v${app.getVersion()}`,
    OS: process.platform,
    'X-Edition': edition,
    'X-Region': region
  }
}

class ReleaseNotesUpdater extends AppUpdater {
  constructor() {
    super(undefined)
  }

  async getSelectedDownloadUrls(): Promise<URL[]> {
    const selected = this.updateInfoAndProvider
    if (!selected) throw new Error('STALE_CANDIDATE')
    return Promise.all(
      selected.provider.resolveFiles(selected.info).map(async ({ url }) => {
        if (url.origin !== 'https://releases.cherry-ai.com') return url
        // Resolve the existing mirror decision without downloading the legacy installer.
        const response = await net.fetch(url.href, {
          headers: this.requestHeaders as Record<string, string>,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000)
        })
        try {
          const location = response.headers.get('location')
          if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error('INVALID_PACKAGE')
          return new URL(location, url)
        } finally {
          await response.body?.cancel()
        }
      })
    )
  }

  protected doDownloadUpdate(): Promise<string[]> {
    return Promise.reject(new Error('Release-notes updater cannot download updates'))
  }

  quitAndInstall(): never {
    throw new Error('Release-notes updater cannot install updates')
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
@DependsOn(['WindowManager', 'SchedulerService', 'PowerService'])
export class AppUpdaterService extends BaseService {
  private stopping = false
  private generation = 0
  private legacyGeneration = 0
  private physicalOperation: Promise<unknown> | null = null
  private installation: Promise<void> | null = null
  private backend: VelopackBackend | null = null
  private readonly usesVelopack = typeof __VELOPACK__ !== 'undefined' && __VELOPACK__
  private snapshot: UpdateSnapshot = {
    sessionId: randomUUID(),
    revision: 0,
    phase: 'idle',
    release: null,
    percent: null,
    error: null
  }
  private cancellationToken: CancellationToken = new CancellationToken()
  private updateCheckResult: UpdateCheckResult | null = null
  // Consecutive scheduled-check failures, drives backoff; reset on success.
  private updateCheckFailures = 0

  protected async onInit(): Promise<void> {
    this.stopping = false
    if (this.usesVelopack) this.readPreviousAttempt()
    autoUpdater.logger = logger as Logger
    // Packaged builds use app-update.yml generated from electron-builder.yml;
    // development uses the repository's dev-app-update.yml.
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = false
    // Never auto-install on quit - user must explicitly click "Install Now"
    // Auto-install on quit can cause issues: unexpected updates on restart,
    // corruption if system shuts down during install, or app uninstall on force shutdown
    autoUpdater.autoInstallOnAppQuit = false

    if (!this.usesVelopack) this.registerAutoUpdaterListeners()

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
    this.registerDisposable(
      application.get('PowerService').registerShutdownHandler(() => {
        autoUpdater.autoDownload = false
        this.cancelDownload()
      })
    )

    // Development builds skip automatic checks but still support manual checks.
    // Portable builds do not perform update checks.
    if (!app.isPackaged || this.isPortable()) {
      return
    }
    this.scheduleNextUpdateCheck(INITIAL_CHECK_DELAY_MS)
  }

  private registerAutoUpdaterListeners(): void {
    const onError = (error: Error) => {
      if (!this.isCurrent(this.legacyGeneration)) return
      logger.error('update error', error)
      this.reportFailure(error)
    }
    autoUpdater.on('error', onError)
    this.registerDisposable(() => autoUpdater.removeListener('error', onError))

    const onUpdateAvailable = (releaseInfo: UpdateInfo) => {
      if (!this.isCurrent(this.legacyGeneration)) return
      logger.info('update available', releaseInfo)
      const processedReleaseInfo = this.publicRelease(releaseInfo)
      this.publish({ phase: 'downloading', release: processedReleaseInfo, percent: null, error: null })
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.available', processedReleaseInfo)
    }
    autoUpdater.on('update-available', onUpdateAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-available', onUpdateAvailable))

    const onUpdateNotAvailable = () => {
      if (!this.isCurrent(this.legacyGeneration)) return
      this.publish({ phase: 'idle', release: null, percent: null })
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.not_available', undefined)
    }
    autoUpdater.on('update-not-available', onUpdateNotAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-not-available', onUpdateNotAvailable))

    const onDownloadProgress = (progress: ProgressInfo) => {
      if (!this.isCurrent(this.legacyGeneration)) return
      this.publish({ percent: Math.min(100, Math.max(0, progress.percent)) })
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.download_progress', progress)
    }
    autoUpdater.on('download-progress', onDownloadProgress)
    this.registerDisposable(() => autoUpdater.removeListener('download-progress', onDownloadProgress))

    const onUpdateDownloaded = (releaseInfo: UpdateInfo) => {
      if (!this.isCurrent(this.legacyGeneration) || !this.snapshot.release) return
      const processedReleaseInfo = {
        ...this.publicRelease(releaseInfo),
        candidateId: this.snapshot.release.candidateId
      }
      this.publish({ phase: 'ready', release: processedReleaseInfo, percent: 100 })
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.downloaded', processedReleaseInfo)
      logger.info('update downloaded', processedReleaseInfo)
    }
    autoUpdater.on('update-downloaded', onUpdateDownloaded)
    this.registerDisposable(() => autoUpdater.removeListener('update-downloaded', onUpdateDownloaded))
  }

  private async getUpdateRequest() {
    const currentVersion = app.getVersion()
    const testPlan = application.get('PreferenceService').get('app.dist.test_plan.enabled')
    const requestedChannel = testPlan
      ? application.get('PreferenceService').get('app.dist.test_plan.channel') || UpgradeChannel.RC
      : UpgradeChannel.LATEST

    const ipCountry = await regionService.getCountry()
    const region: ReleaseRegion = ipCountry.toLowerCase() === 'cn' ? 'cn' : 'global'
    const edition = getAppEdition()
    const updateChannel = getEditionUpdateChannel(requestedChannel, edition)

    const updateHeaders = getUpdateHeaders({ region, edition })

    return { currentVersion, edition, ipCountry, region, testPlan, updateChannel, updateHeaders }
  }

  private async configureUpdaterForCheck() {
    const { currentVersion, edition, ipCountry, region, testPlan, updateChannel, updateHeaders } =
      await this.getUpdateRequest()

    autoUpdater.requestHeaders = {
      ...autoUpdater.requestHeaders,
      ...updateHeaders
    }

    logger.info(
      `Using managed update feed for version ${currentVersion}, edition: ${edition}, testPlan: ${testPlan}, channel: ${updateChannel}, region: ${region} (IP country: ${ipCountry})`
    )
    autoUpdater.channel = updateChannel

    // disable downgrade after change the channel
    autoUpdater.allowDowngrade = false
    // Keep differential downloads disabled for the current release artifacts.
    autoUpdater.disableDifferentialDownload = true
  }

  private async fetchReleaseHistory(): Promise<ReleaseNotesEntry[] | null> {
    try {
      const { updateHeaders } = await this.getUpdateRequest()
      const response = await net.fetch(RELEASE_HISTORY_URL, {
        headers: updateHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(RELEASE_HISTORY_TIMEOUT_MS)
      })

      if (!response.ok) {
        throw new Error(`Release history request failed with HTTP ${response.status}`)
      }

      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > RELEASE_HISTORY_MAX_BYTES) {
        throw new Error('Release history response exceeds the size limit')
      }

      const source = await response.text()
      if (Buffer.byteLength(source, 'utf8') > RELEASE_HISTORY_MAX_BYTES) {
        throw new Error('Release history response exceeds the size limit')
      }

      return parseReleaseHistory(source)
    } catch (error) {
      logger.warn('Failed to fetch release history', error as Error)
      return null
    }
  }

  public async queryUpdateAvailability(): Promise<
    | { status: 'unsupported' }
    | { status: 'current'; currentVersion: string }
    | { status: 'available'; currentVersion: string; version: string }
  > {
    if (this.isPortable()) return { status: 'unsupported' }
    const { currentVersion, updateChannel, updateHeaders } = await this.getUpdateRequest()
    const updater = new ReleaseNotesUpdater()
    updater.logger = logger as Logger
    updater.forceDevUpdateConfig = !app.isPackaged
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.requestHeaders = updateHeaders
    updater.channel = updateChannel
    updater.allowDowngrade = false
    const result = await updater.checkForUpdates()
    if (!result) throw new Error('Update query did not produce a result')
    return result.isUpdateAvailable
      ? { status: 'available', currentVersion, version: result.updateInfo.version }
      : { status: 'current', currentVersion }
  }

  public async getLatestReleaseNotes(): Promise<ReleaseNotesEntry | null> {
    try {
      const { updateChannel, updateHeaders } = await this.getUpdateRequest()
      const updater = new ReleaseNotesUpdater()
      updater.logger = logger as Logger
      updater.forceDevUpdateConfig = !app.isPackaged
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.requestHeaders = updateHeaders
      updater.channel = updateChannel
      updater.allowDowngrade = false

      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable) {
        return null
      }

      const releaseNotes = result.updateInfo.releaseNotes
      if (typeof releaseNotes !== 'string' || !releaseNotes.trim()) {
        return null
      }

      return { releaseNotes, version: result.updateInfo.version }
    } catch (error) {
      logger.warn('Failed to fetch latest release notes', error as Error)
      return null
    }
  }

  public async getReleaseHistory(): Promise<ReleaseNotesEntry[] | null> {
    const [history, latestRelease] = await Promise.all([this.fetchReleaseHistory(), this.getLatestReleaseNotes()])

    if (!history) {
      return latestRelease ? [latestRelease] : null
    }

    return latestRelease ? mergeReleaseHistory([latestRelease], history) : history
  }

  public cancelDownload() {
    if (this.snapshot.phase === 'installing') return
    this.generation++
    this.backend = null
    this.publish({ phase: this.physicalOperation ? 'cancelling' : 'idle', release: null, percent: null, error: null })
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
    if (this.stopping || this.installation) throw new IpcError('UPDATE_BUSY')
    if (this.physicalOperation) return this.physicalOperation
    if (this.snapshot.phase === 'ready') return
    const generation = this.generation
    this.legacyGeneration = generation
    this.publish({ phase: 'checking', error: null })
    const operation = this.runUpdateCheck(generation).catch((error: unknown) => {
      if (this.isCurrent(generation)) {
        this.reportFailure(error)
        throw error
      }
    })
    this.physicalOperation = operation
    try {
      return await operation
    } finally {
      if (this.physicalOperation === operation) this.physicalOperation = null
      if (!this.stopping && this.snapshot.phase === 'cancelling') this.publish({ phase: 'idle' })
    }
  }

  private async runUpdateCheck(generation: number) {
    void application.get('AnalyticsService').trackAppUpdate()

    if (this.isPortable()) {
      this.publish({ phase: 'unavailable' })
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    if (this.usesVelopack && process.env.CHERRY_VELOPACK_UNAVAILABLE === '1') {
      this.publish({ phase: 'unavailable', error: 'SDK_UNAVAILABLE' })
      application
        .get('IpcApiService')
        .broadcastToType(WindowType.Main, 'app.updater.error', { message: 'SDK_UNAVAILABLE' })
      return
    }
    if (this.usesVelopack) return this.checkVelopack(generation)
    await this.configureUpdaterForCheck()
    if (!this.isCurrent(generation)) return

    this.updateCheckResult = await autoUpdater.checkForUpdates()
    if (!this.isCurrent(generation)) return
    logger.info(
      `update check result: ${this.updateCheckResult?.isUpdateAvailable}, channel: ${autoUpdater.channel}, currentVersion: ${autoUpdater.currentVersion}`
    )

    if (this.updateCheckResult?.isUpdateAvailable && !autoUpdater.autoDownload) {
      logger.info('downloadUpdate manual by check for updates', this.cancellationToken)
      await autoUpdater.downloadUpdate(this.cancellationToken)
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
      if (!(error instanceof IpcError) && !this.stopping && this.snapshot.phase !== 'cancelling')
        this.reportFailure(error)
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
    if (this.stopping) return
    application
      .get('SchedulerService')
      .registerSchedule(AUTO_UPDATE_SCHEDULE_ID, { kind: 'once', at: Date.now() + delayMs }, () =>
        this.runScheduledUpdateCheck()
      )
  }

  private async runScheduledUpdateCheck(): Promise<void> {
    try {
      // Keep the schedule alive while automatic checks are disabled.
      if (application.get('PreferenceService').get('app.dist.auto_update.enabled')) {
        await this.performUpdateCheck()
      }
      this.updateCheckFailures = 0
      this.scheduleNextUpdateCheck(this.nextUpdateCheckDelayMs())
    } catch {
      if (this.stopping) return
      this.updateCheckFailures++
      const backoffMs = computeBackoff(CHECK_RETRY_POLICY, this.updateCheckFailures)
      logger.warn(`scheduled update check failed, backing off for ${backoffMs}ms`)
      this.scheduleNextUpdateCheck(backoffMs)
    }
  }

  private nextUpdateCheckDelayMs(): number {
    return Math.round(CHECK_INTERVAL_MS * (1 + (Math.random() * 2 - 1) * CHECK_JITTER_RATIO))
  }

  public quitAndInstall(candidateId: string): Promise<void> {
    if (this.stopping || candidateId !== this.snapshot.release?.candidateId)
      return Promise.reject(new IpcError('STALE_CANDIDATE'))
    if (this.installation) return this.installation
    if (this.snapshot.phase !== 'ready' || this.physicalOperation) return Promise.reject(new IpcError('UPDATE_BUSY'))
    const generation = this.generation
    this.installation = this.install(generation).finally(() => {
      this.installation = null
    })
    return this.installation
  }

  private async install(generation: number): Promise<void> {
    const backend = this.backend
    let verified = !backend
    let writtenJournal: string | undefined
    try {
      if (backend) await backend.verify()
      verified = true
      if (!this.isCurrent(generation)) throw new IpcError('STALE_CANDIDATE')
      const release = this.snapshot.release!
      const handoff = backend ? backend.createHandoff() : () => autoUpdater.quitAndInstall(true, true)
      const journal = application.getPath('feature.updater.journal_file')
      const temporary = application.getPath('feature.updater.journal_temp_file')
      const record = {
        schemaVersion: 1,
        targetVersion: release.version,
        attemptId: release.candidateId
      }
      writeFileSync(temporary, JSON.stringify({ ...record, stage: 'shutdown-requested' }), { mode: 0o600 })
      renameSync(temporary, journal)
      writtenJournal = journal
      this.publish({ phase: 'installing' })
      await application.quitWithAction({
        run: () => {
          writeFileSync(temporary, JSON.stringify({ ...record, stage: 'handoff-requested' }), { mode: 0o600 })
          renameSync(temporary, journal)
          handoff()
        }
      })
    } catch (error) {
      if (writtenJournal) {
        try {
          unlinkSync(writtenJournal)
        } catch (cause) {
          logger.warn('Could not clear cancelled update attempt', cause as Error)
        }
      }
      if (this.isCurrent(generation)) {
        if (!verified) this.backend = null
        this.publish(
          verified ? { phase: 'ready' } : { phase: 'idle', release: null, percent: null, error: 'INVALID_PACKAGE' }
        )
      }
      throw new IpcError(error instanceof IpcError ? error.code : 'UPDATE_INSTALL_FAILED')
    }
  }

  public getSnapshot(): UpdateSnapshot {
    return this.snapshot
  }

  private readPreviousAttempt(): void {
    const journal = application.getPath('feature.updater.journal_file')
    if (!existsSync(journal)) return
    try {
      if (statSync(journal).size > 4096) throw new Error('Invalid update journal')
      const record = JSON.parse(readFileSync(journal, 'utf8'))
      if (record.schemaVersion !== 1 || typeof record.targetVersion !== 'string')
        throw new Error('Invalid update journal')
      if (record.targetVersion === app.getVersion()) {
        logger.info('Updated version is running', { version: record.targetVersion })
        unlinkSync(journal)
      } else {
        logger.warn('Previous update was not observed; a fresh check is required', {
          targetVersion: record.targetVersion
        })
        this.publish({ error: 'UPDATE_NOT_APPLIED' })
      }
    } catch (error) {
      logger.warn('Could not read update attempt', error as Error)
    }
  }

  private publish(change: Partial<UpdateSnapshot>): void {
    if (this.stopping) return
    this.snapshot = { ...this.snapshot, ...change, revision: this.snapshot.revision + 1 }
    try {
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.state_changed', this.snapshot)
    } catch (error) {
      logger.warn('Could not broadcast update state', error as Error)
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.stopping && generation === this.generation
  }

  private publicRelease(info: UpdateInfo): UpdateRelease {
    const localized = this.processReleaseInfo(info)
    return {
      candidateId: randomUUID(),
      version: localized.version,
      releaseNotes: localized.releaseNotes ?? undefined,
      releaseDate: localized.releaseDate
    }
  }

  private reportFailure(error: unknown): void {
    logger.error('Update operation failed', error as Error)
    if (this.snapshot.error) return
    this.publish({ phase: 'idle', release: null, percent: null, error: 'UPDATE_FAILED' })
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.error', { message: 'UPDATE_FAILED' })
  }

  private async checkVelopack(generation: number): Promise<void> {
    const { getVelopackChannel, VelopackBackend } = await import('./appUpdater/velopackBackend')
    const { updateChannel, updateHeaders, edition } = await this.getUpdateRequest()
    if (!this.isCurrent(generation)) return
    const selector = new ReleaseNotesUpdater()
    selector.logger = logger as Logger
    selector.autoDownload = false
    selector.autoInstallOnAppQuit = false
    selector.requestHeaders = updateHeaders
    selector.channel = updateChannel
    selector.allowDowngrade = false
    const result = await selector.checkForUpdates()
    if (!this.isCurrent(generation)) return
    if (!result) throw new Error('UPDATE_FAILED')
    if (!result.isUpdateAvailable) {
      this.publish({ phase: 'idle', release: null })
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.not_available', undefined)
      return
    }
    const downloadUrls = await selector.getSelectedDownloadUrls()
    if (!this.isCurrent(generation)) return
    const manifest = application.getPath('feature.updater.manifest_file')
    const backend = new VelopackBackend(
      {
        RootAppDir: application.getPath('feature.updater.root'),
        CurrentBinaryDir: application.getPath('app.install'),
        UpdateExePath: application.getPath('feature.updater.helper_file'),
        ManifestPath: existsSync(manifest) ? manifest : application.getPath('feature.updater.resources_manifest_file'),
        PackagesDir: application.getPath('feature.updater.packages'),
        IsPortable: process.platform !== 'win32'
      },
      edition,
      getVelopackChannel(process.platform as SupportedPlatform, process.arch, edition),
      app.getVersion()
    )
    await backend.resolve(result.updateInfo.version, downloadUrls)
    if (!this.isCurrent(generation)) return
    const release = this.publicRelease(result.updateInfo)
    this.publish({ phase: 'downloading', release, percent: null })
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.available', release)
    await backend.prepare((percent) => {
      if (this.isCurrent(generation)) this.publish({ percent: Math.min(100, Math.max(0, percent)) })
    })
    if (!this.isCurrent(generation)) return
    this.backend = backend
    this.publish({ phase: 'ready', percent: 100 })
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.downloaded', release)
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    this.generation++
    this.cancellationToken.cancel()
    this.updateCheckResult?.cancellationToken?.cancel()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([this.physicalOperation, this.installation]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Updater drain timed out')), 3000)
        })
      ])
    } finally {
      clearTimeout(timer)
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
      if (hasMultiLanguageReleaseNotes(releaseInfo.releaseNotes)) {
        try {
          const language = application.get('PreferenceService').get('app.language')
          processedInfo.releaseNotes = localizeReleaseNotes(releaseInfo.releaseNotes, language)
        } catch (error) {
          logger.error('Failed to localize release notes', error as Error)
        }
      }
    }

    return processedInfo
  }
}

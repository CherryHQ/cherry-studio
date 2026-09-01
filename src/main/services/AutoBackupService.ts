import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { hasWritePermission, isPathInside, untildify } from '@main/utils/legacyFile'
import type { CacheAutoBackupTerminalOutcome } from '@shared/data/cache/cacheValueTypes'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import {
  AUTO_BACKUP_TYPES,
  type AutoBackupEvent,
  type AutoBackupEventInput,
  type AutoBackupLastSuccessTimes,
  type AutoBackupSnapshot,
  type AutoBackupType,
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  type S3Config,
  type WebDavConfig
} from '@shared/types/backup'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'

import { BackupOperationBusyError, legacyBackupManager } from './LegacyBackupManager'
import { decryptToken } from './nutstore/NutstoreService'

const logger = loggerService.withContext('AutoBackupService')

const SCHEDULE_ID_PREFIX = 'auto-backup:'
const LAST_ATTEMPT_TIMES_KEY = 'backup.auto_sync.last_attempt_times'
const LAST_SUCCESS_TIMES_KEY = 'backup.auto_sync.last_success_times'
const LATEST_TERMINAL_OUTCOMES_KEY = 'backup.auto_sync.latest_terminal_outcomes'
const MAX_ATTEMPTS = 4
const INITIAL_DELAY_MS = 1_000
const STARTUP_GRACE_PERIOD_MS = 60_000

const WATCHED_PREFERENCES: Record<AutoBackupType, UnifiedPreferenceKeyType[]> = {
  webdav: ['data.backup.webdav.auto_sync', 'data.backup.webdav.host', 'data.backup.webdav.sync_interval'],
  s3: ['data.backup.s3.auto_sync', 'data.backup.s3.endpoint', 'data.backup.s3.sync_interval'],
  local: ['data.backup.local.auto_sync', 'data.backup.local.dir', 'data.backup.local.sync_interval'],
  nutstore: ['data.backup.nutstore.auto_sync', 'data.backup.nutstore.token', 'data.backup.nutstore.sync_interval']
}

type ScheduleMode = 'immediate' | 'startup' | 'fromLastSyncTime' | 'fromNow'

interface ScheduleState {
  generation: number
  lastSyncTime: number | null
  retryCount: number
  running: boolean
}

interface ScheduleSettings {
  enabled: boolean
  intervalMs: number
}

const createScheduleState = (): ScheduleState => ({
  generation: 0,
  lastSyncTime: null,
  retryCount: 0,
  running: false
})

const createLastSuccessTimes = (): AutoBackupLastSuccessTimes => ({
  webdav: null,
  s3: null,
  local: null,
  nutstore: null
})

@Injectable('AutoBackupService')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'SchedulerService',
  'WindowManager',
  'ChannelManager',
  'AiStreamManager',
  'AgentSessionRuntimeService',
  'JobManager'
])
export class AutoBackupService extends BaseService {
  private active = false
  private activeRun: Promise<void> | null = null
  private activeRunType: AutoBackupType | null = null
  private activeAbortController: AbortController | null = null
  private nextEventId = 0
  private readonly latestTerminalEvents = new Map<AutoBackupType, AutoBackupEvent>()
  private readonly latestTransientEvents = new Map<AutoBackupType, AutoBackupEvent>()
  private readonly pendingNotifications = new Map<AutoBackupType, AutoBackupEvent>()
  private readonly pendingRuns = new Map<AutoBackupType, number>()
  private lastSuccessTimes = createLastSuccessTimes()
  private readonly schedules: Record<AutoBackupType, ScheduleState> = {
    webdav: createScheduleState(),
    s3: createScheduleState(),
    local: createScheduleState(),
    nutstore: createScheduleState()
  }

  protected override onInit(): void {
    const cacheService = application.get('CacheService')
    const lastAttemptTimes = cacheService.getPersist(LAST_ATTEMPT_TIMES_KEY)
    this.lastSuccessTimes = { ...cacheService.getPersist(LAST_SUCCESS_TIMES_KEY) }
    this.nextEventId = 0
    this.latestTerminalEvents.clear()
    this.latestTransientEvents.clear()
    this.pendingNotifications.clear()

    const terminalOutcomes = cacheService.getPersist(LATEST_TERMINAL_OUTCOMES_KEY)
    for (const type of AUTO_BACKUP_TYPES) {
      this.schedules[type].lastSyncTime = lastAttemptTimes[type]
      const outcome = terminalOutcomes[type]
      if (outcome) {
        this.latestTerminalEvents.set(type, this.createEvent(this.restoreTerminalOutcome(type, outcome)))
      }
    }

    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeMultipleChanges(Object.values(WATCHED_PREFERENCES).flat(), (key) => {
        const type = AUTO_BACKUP_TYPES.find((candidate) => WATCHED_PREFERENCES[candidate].includes(key))
        if (type) {
          this.applyConfigurationChange(type, key)
        }
      })
    )
    this.registerDisposable(() => this.unregisterAllSchedules())
  }

  protected override onReady(): void {
    this.active = true
    for (const type of AUTO_BACKUP_TYPES) {
      this.restartSchedule(type, 'startup')
    }
  }

  protected override async onStop(): Promise<void> {
    this.active = false
    this.unregisterAllSchedules()
    this.pendingRuns.clear()
    this.latestTransientEvents.clear()
    this.activeAbortController?.abort(new DOMException('Automatic backup service stopped.', 'AbortError'))
    for (const type of AUTO_BACKUP_TYPES) {
      this.schedules[type].generation++
      this.schedules[type].running = false
      this.schedules[type].retryCount = 0
    }
    await this.activeRun
  }

  getStateSnapshot(): AutoBackupSnapshot {
    return {
      lastSuccessTimes: { ...this.lastSuccessTimes },
      events: [...this.latestTerminalEvents.values(), ...this.latestTransientEvents.values()].sort(
        (first, second) => first.id - second.id
      ),
      pendingNotifications: [...this.pendingNotifications.values()]
    }
  }

  acknowledgeNotification(type: AutoBackupType, id: number): void {
    if (this.pendingNotifications.get(type)?.id === id) {
      this.pendingNotifications.delete(type)
    }
  }

  recordManualBackupCompletion(type: AutoBackupType): void {
    const timestamp = Date.now()
    this.recordLastAttemptTime(type, timestamp)
    this.recordLastSuccessTime(type, timestamp)
    this.clearTerminalOutcome(type)
    if (this.active) this.restartSchedule(type, 'fromLastSyncTime')
  }

  // Not folded into `restartSchedule`: startup reaches that too and must keep the
  // outcome it just restored. Without this, a disabled backend keeps its failure icon.
  private applyConfigurationChange(type: AutoBackupType, key: UnifiedPreferenceKeyType): void {
    // Rescheduling alone does not refute what the last attempt found; only switching the
    // backend off or repointing it does.
    if (!key.endsWith('.sync_interval')) this.clearTerminalOutcome(type)
    this.restartSchedule(type, key === 'data.backup.local.dir' ? 'immediate' : 'fromLastSyncTime')
  }

  private clearTerminalOutcome(type: AutoBackupType): void {
    this.latestTerminalEvents.delete(type)
    this.pendingNotifications.delete(type)
    const cacheService = application.get('CacheService')
    cacheService.setPersist(LATEST_TERMINAL_OUTCOMES_KEY, {
      ...cacheService.getPersist(LATEST_TERMINAL_OUTCOMES_KEY),
      [type]: null
    })
  }

  private recordLastAttemptTime(type: AutoBackupType, timestamp: number): void {
    this.schedules[type].lastSyncTime = timestamp
    const cacheService = application.get('CacheService')
    cacheService.setPersist(LAST_ATTEMPT_TIMES_KEY, {
      ...cacheService.getPersist(LAST_ATTEMPT_TIMES_KEY),
      [type]: timestamp
    })
  }

  private recordLastSuccessTime(type: AutoBackupType, timestamp: number): void {
    this.lastSuccessTimes = { ...this.lastSuccessTimes, [type]: timestamp }
    application.get('CacheService').setPersist(LAST_SUCCESS_TIMES_KEY, this.lastSuccessTimes)
  }

  private recordTerminalOutcome(event: AutoBackupEvent): void {
    if (event.status === 'running' || event.status === 'stopped') return

    const outcome: CacheAutoBackupTerminalOutcome =
      event.status === 'failed'
        ? {
            status: 'failed',
            timestamp: event.timestamp,
            failureKind: event.errorMessage.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)
              ? 'active_data_writers'
              : 'unknown'
          }
        : event.status === 'warning'
          ? { status: 'warning', timestamp: event.timestamp, reason: event.reason }
          : { status: 'succeeded', timestamp: event.timestamp }

    const cacheService = application.get('CacheService')
    cacheService.setPersist(LATEST_TERMINAL_OUTCOMES_KEY, {
      ...cacheService.getPersist(LATEST_TERMINAL_OUTCOMES_KEY),
      [event.type]: outcome
    })
  }

  private restoreTerminalOutcome(type: AutoBackupType, outcome: CacheAutoBackupTerminalOutcome): AutoBackupEventInput {
    if (outcome.status === 'failed') {
      return {
        type,
        status: 'failed',
        timestamp: outcome.timestamp,
        errorMessage: outcome.failureKind === 'active_data_writers' ? BACKUP_ACTIVE_WRITERS_ERROR_CODE : ''
      }
    }
    return { type, ...outcome }
  }

  private createEvent(event: AutoBackupEventInput): AutoBackupEvent {
    return { ...event, id: ++this.nextEventId } as AutoBackupEvent
  }

  private restartSchedule(type: AutoBackupType, mode: ScheduleMode): void {
    const state = this.schedules[type]
    state.generation++
    state.retryCount = 0
    this.unregisterSchedule(type)
    this.pendingRuns.delete(type)

    if (this.activeRunType === type) {
      this.activeAbortController?.abort(new DOMException('Automatic backup schedule changed.', 'AbortError'))
    }

    if (state.running && this.activeRunType !== type) {
      state.running = false
      this.emit({ type, status: 'stopped' })
    }

    this.scheduleNext(type, mode, state.generation)
  }

  private scheduleNext(type: AutoBackupType, mode: ScheduleMode, generation: number, delayOverride?: number): void {
    if (!this.isCurrent(type, generation)) return

    this.unregisterSchedule(type)
    const settings = this.getScheduleSettings(type)
    if (!settings.enabled || settings.intervalMs <= 0) {
      logger.debug('Automatic backup is disabled or incomplete', { type })
      return
    }

    let delay = delayOverride ?? INITIAL_DELAY_MS
    if (delayOverride === undefined && mode === 'fromNow') {
      delay = settings.intervalMs
    } else if (delayOverride === undefined && (mode === 'startup' || mode === 'fromLastSyncTime')) {
      const lastSyncTime = this.schedules[type].lastSyncTime
      delay = lastSyncTime
        ? Math.max(INITIAL_DELAY_MS, lastSyncTime + settings.intervalMs - Date.now())
        : settings.intervalMs
      if (mode === 'startup') {
        delay = Math.max(STARTUP_GRACE_PERIOD_MS, delay)
      }
    }

    application
      .get('SchedulerService')
      .registerSchedule(this.scheduleId(type), { kind: 'once', at: Date.now() + delay }, () =>
        this.handleScheduledBackup(type, generation)
      )
    logger.debug('Automatic backup scheduled', { type, delayMs: delay })
  }

  private async handleScheduledBackup(type: AutoBackupType, generation: number): Promise<void> {
    if (!this.isEnabled(type, generation)) return

    if (this.activeRun) {
      this.pendingRuns.set(type, generation)
      logger.debug('Another automatic backup is running; queued', { type, activeType: this.activeRunType })
      return
    }

    const abortController = new AbortController()
    const run = this.runAttempt(type, generation, abortController.signal)
    this.activeRun = run
    this.activeRunType = type
    this.activeAbortController = abortController
    try {
      await run
    } finally {
      if (this.activeRun === run) {
        this.activeRun = null
        this.activeRunType = null
        this.activeAbortController = null
        this.schedulePendingRuns()
      }
    }
  }

  private async runAttempt(type: AutoBackupType, generation: number, signal: AbortSignal): Promise<void> {
    const state = this.schedules[type]
    if (!state.running) {
      state.running = true
      this.emit({ type, status: 'running' })
    }

    try {
      logger.info('Starting automatic backup', { type, attempt: state.retryCount + 1, maxAttempts: MAX_ATTEMPTS })
      const cleanupError = await this.runBackup(type, signal)

      if (!this.isEnabled(type, generation)) {
        this.markStopped(type)
        return
      }

      const timestamp = Date.now()
      this.recordLastAttemptTime(type, timestamp)
      this.recordLastSuccessTime(type, timestamp)
      state.retryCount = 0
      state.running = false
      if (cleanupError) {
        logger.warn('Automatic backup completed but old backups could not be cleaned up', {
          type,
          error: cleanupError.message
        })
        this.emit({ type, status: 'warning', timestamp, reason: 'cleanup_failed' })
      } else {
        this.emit({ type, status: 'succeeded', timestamp })
      }
      this.scheduleNext(type, 'fromNow', generation)
    } catch (error) {
      if (!this.isEnabled(type, generation)) {
        this.markStopped(type)
        return
      }

      if (error instanceof BackupOperationBusyError) {
        logger.debug('Another backup operation is running; automatic backup postponed', { type })
        this.recordLastAttemptTime(type, Date.now())
        this.markStopped(type)
        this.scheduleNext(type, 'fromNow', generation)
        return
      }

      state.retryCount++
      if (state.retryCount < MAX_ATTEMPTS) {
        const delay = 2 ** (state.retryCount - 1) * 10_000 - 3_000
        logger.warn('Automatic backup failed; retry scheduled', { type, retry: state.retryCount, delayMs: delay })
        this.scheduleNext(type, 'immediate', generation, delay)
        return
      }

      const timestamp = Date.now()
      this.recordLastAttemptTime(type, timestamp)
      state.retryCount = 0
      state.running = false
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Automatic backup failed after all attempts', error as Error)
      this.emit({ type, status: 'failed', timestamp, errorMessage })
      this.scheduleNext(type, 'fromNow', generation)
    }
  }

  private async runBackup(type: AutoBackupType, signal: AbortSignal): Promise<Error | null> {
    const preferenceService = application.get('PreferenceService')

    if (type === 'webdav') {
      const config: WebDavConfig = {
        webdavHost: preferenceService.get('data.backup.webdav.host'),
        webdavUser: preferenceService.get('data.backup.webdav.user'),
        webdavPass: preferenceService.get('data.backup.webdav.pass'),
        webdavPath: preferenceService.get('data.backup.webdav.path'),
        maxBackups: preferenceService.get('data.backup.webdav.max_backups'),
        skipBackupFile: preferenceService.get('data.backup.webdav.skip_backup_file'),
        disableStream: preferenceService.get('data.backup.webdav.disable_stream')
      }
      const { result: success, cleanupError } = await legacyBackupManager.backupToWebdav(null, config, signal)
      if (success === false) throw new Error('WebDAV automatic backup failed')
      return cleanupError
    }

    if (type === 's3') {
      const config: S3Config = {
        endpoint: preferenceService.get('data.backup.s3.endpoint'),
        region: preferenceService.get('data.backup.s3.region'),
        bucket: preferenceService.get('data.backup.s3.bucket'),
        accessKeyId: preferenceService.get('data.backup.s3.access_key_id'),
        secretAccessKey: preferenceService.get('data.backup.s3.secret_access_key'),
        root: preferenceService.get('data.backup.s3.root'),
        skipBackupFile: preferenceService.get('data.backup.s3.skip_backup_file'),
        autoSync: preferenceService.get('data.backup.s3.auto_sync'),
        syncInterval: preferenceService.get('data.backup.s3.sync_interval'),
        maxBackups: preferenceService.get('data.backup.s3.max_backups')
      }
      const { cleanupError } = await legacyBackupManager.backupToS3(null, config, signal)
      return cleanupError
    }

    if (type === 'local') {
      const directory = path.resolve(untildify(preferenceService.get('data.backup.local.dir')))
      await this.validateLocalBackupDirectory(directory)
      const { cleanupError } = await legacyBackupManager.backupToLocalDir(
        null,
        undefined,
        {
          localBackupDir: directory,
          maxBackups: preferenceService.get('data.backup.local.max_backups'),
          skipBackupFile: preferenceService.get('data.backup.local.skip_backup_file')
        },
        signal
      )
      return cleanupError
    }

    const credentials = await decryptToken(preferenceService.get('data.backup.nutstore.token'))
    if (!credentials) throw new Error('Nutstore credentials are unavailable')

    const config: WebDavConfig = {
      webdavHost: NUTSTORE_HOST,
      webdavUser: credentials.username,
      webdavPass: credentials.access_token,
      webdavPath: preferenceService.get('data.backup.nutstore.path'),
      maxBackups: preferenceService.get('data.backup.nutstore.max_backups'),
      skipBackupFile: preferenceService.get('data.backup.nutstore.skip_backup_file')
    }
    const { result: success, cleanupError } = await legacyBackupManager.backupToWebdav(null, config, signal)
    if (success === false) throw new Error('Nutstore automatic backup failed')
    return cleanupError
  }

  private async validateLocalBackupDirectory(directory: string): Promise<void> {
    if (
      isPathInside(directory, application.getPath('app.userdata')) ||
      isPathInside(directory, application.getPath('app.install'))
    ) {
      throw new Error('Local automatic backup directory cannot be inside application data or installation directory.')
    }

    if (!(await hasWritePermission(directory))) {
      throw new Error('Local automatic backup directory does not exist or is not writable.')
    }
  }

  private getScheduleSettings(type: AutoBackupType): ScheduleSettings {
    const preferenceService = application.get('PreferenceService')
    if (type === 'webdav') {
      return {
        enabled:
          preferenceService.get('data.backup.webdav.auto_sync') &&
          Boolean(preferenceService.get('data.backup.webdav.host')),
        intervalMs: preferenceService.get('data.backup.webdav.sync_interval') * 60_000
      }
    }
    if (type === 's3') {
      return {
        enabled:
          preferenceService.get('data.backup.s3.auto_sync') &&
          Boolean(preferenceService.get('data.backup.s3.endpoint')),
        intervalMs: preferenceService.get('data.backup.s3.sync_interval') * 60_000
      }
    }
    if (type === 'local') {
      return {
        enabled:
          preferenceService.get('data.backup.local.auto_sync') &&
          Boolean(preferenceService.get('data.backup.local.dir')),
        intervalMs: preferenceService.get('data.backup.local.sync_interval') * 60_000
      }
    }
    return {
      enabled:
        preferenceService.get('data.backup.nutstore.auto_sync') &&
        Boolean(preferenceService.get('data.backup.nutstore.token')),
      intervalMs: preferenceService.get('data.backup.nutstore.sync_interval') * 60_000
    }
  }

  private isEnabled(type: AutoBackupType, generation: number): boolean {
    const settings = this.getScheduleSettings(type)
    return this.isCurrent(type, generation) && settings.enabled && settings.intervalMs > 0
  }

  private isCurrent(type: AutoBackupType, generation: number): boolean {
    return this.active && this.schedules[type].generation === generation
  }

  private markStopped(type: AutoBackupType): void {
    const state = this.schedules[type]
    state.retryCount = 0
    if (!state.running) return
    state.running = false
    this.emit({ type, status: 'stopped' })
  }

  private emit(event: AutoBackupEventInput): void {
    if (!this.active) return
    const emittedEvent = this.createEvent(event)
    if (event.status === 'running' || event.status === 'stopped') {
      this.latestTransientEvents.set(event.type, emittedEvent)
    } else {
      this.latestTerminalEvents.set(event.type, emittedEvent)
      this.latestTransientEvents.delete(event.type)
      this.recordTerminalOutcome(emittedEvent)
    }
    if (event.status === 'warning' || event.status === 'failed') {
      this.pendingNotifications.set(event.type, emittedEvent)
    }
    const ipcApiService = application.get('IpcApiService')
    ipcApiService.broadcastToType(WindowType.Main, 'backup.auto_sync_state_changed', emittedEvent)
    ipcApiService.broadcastToType(WindowType.SubWindow, 'backup.auto_sync_state_changed', emittedEvent)
  }

  private unregisterAllSchedules(): void {
    for (const type of AUTO_BACKUP_TYPES) this.unregisterSchedule(type)
  }

  private schedulePendingRuns(): void {
    for (const [type, generation] of this.pendingRuns) {
      this.pendingRuns.delete(type)
      if (this.isEnabled(type, generation)) {
        this.scheduleNext(type, 'immediate', generation)
      }
    }
  }

  private unregisterSchedule(type: AutoBackupType): void {
    application.get('SchedulerService').unregister(this.scheduleId(type))
  }

  private scheduleId(type: AutoBackupType): string {
    return `${SCHEDULE_ID_PREFIX}${type}`
  }
}

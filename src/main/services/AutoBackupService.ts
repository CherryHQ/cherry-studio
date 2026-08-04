import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { hasWritePermission, isPathInside, untildify } from '@main/utils/legacyFile'
import { getDeviceType, getHostname } from '@main/utils/system'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { AutoBackupEvent, AutoBackupType, S3Config, WebDavConfig } from '@shared/types/backup'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'
import dayjs from 'dayjs'

import { BackupOperationBusyError, legacyBackupManager } from './LegacyBackupManager'
import { decryptToken } from './nutstore/NutstoreService'

const logger = loggerService.withContext('AutoBackupService')

const AUTO_BACKUP_TYPES: AutoBackupType[] = ['webdav', 's3', 'local', 'nutstore']
const SCHEDULE_ID_PREFIX = 'auto-backup:'
const MAX_ATTEMPTS = 4
const INITIAL_DELAY_MS = 1_000

const WATCHED_PREFERENCES: Record<AutoBackupType, UnifiedPreferenceKeyType[]> = {
  webdav: ['data.backup.webdav.auto_sync', 'data.backup.webdav.host', 'data.backup.webdav.sync_interval'],
  s3: ['data.backup.s3.auto_sync', 'data.backup.s3.endpoint', 'data.backup.s3.sync_interval'],
  local: ['data.backup.local.auto_sync', 'data.backup.local.dir', 'data.backup.local.sync_interval'],
  nutstore: ['data.backup.nutstore.auto_sync', 'data.backup.nutstore.token', 'data.backup.nutstore.sync_interval']
}

type ScheduleMode = 'immediate' | 'fromLastSyncTime' | 'fromNow'

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

interface BackupFileInfo {
  fileName: string
  modifiedTime: string
  size: number
}

const createScheduleState = (): ScheduleState => ({
  generation: 0,
  lastSyncTime: null,
  retryCount: 0,
  running: false
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
  private readonly pendingRuns = new Map<AutoBackupType, number>()
  private readonly schedules: Record<AutoBackupType, ScheduleState> = {
    webdav: createScheduleState(),
    s3: createScheduleState(),
    local: createScheduleState(),
    nutstore: createScheduleState()
  }

  protected override onInit(): void {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeMultipleChanges(Object.values(WATCHED_PREFERENCES).flat(), (key) => {
        const type = AUTO_BACKUP_TYPES.find((candidate) => WATCHED_PREFERENCES[candidate].includes(key))
        if (type) {
          this.restartSchedule(type, key === 'data.backup.local.dir' ? 'immediate' : 'fromLastSyncTime')
        }
      })
    )
    this.registerDisposable(() => this.unregisterAllSchedules())
  }

  protected override onAllReady(): void {
    this.active = true
    for (const type of AUTO_BACKUP_TYPES) {
      this.restartSchedule(type, 'fromLastSyncTime')
    }
  }

  protected override async onStop(): Promise<void> {
    this.active = false
    this.unregisterAllSchedules()
    this.pendingRuns.clear()
    this.activeAbortController?.abort(new DOMException('Automatic backup service stopped.', 'AbortError'))
    for (const type of AUTO_BACKUP_TYPES) {
      this.schedules[type].generation++
      this.schedules[type].running = false
      this.schedules[type].retryCount = 0
    }
    await this.activeRun
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
    } else if (delayOverride === undefined && mode === 'fromLastSyncTime') {
      const lastSyncTime = this.schedules[type].lastSyncTime
      delay = lastSyncTime
        ? Math.max(INITIAL_DELAY_MS, lastSyncTime + settings.intervalMs - Date.now())
        : type === 'nutstore'
          ? settings.intervalMs
          : INITIAL_DELAY_MS
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
      state.lastSyncTime = timestamp
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
      state.lastSyncTime = timestamp
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
    const hostname = getHostname() || 'unknown'
    const deviceType = getDeviceType() || 'unknown'
    const fileName = `cherry-studio.${dayjs().format('YYYYMMDDHHmmss')}.${hostname}.${deviceType}.zip`

    if (type === 'webdav') {
      const config: WebDavConfig = {
        webdavHost: preferenceService.get('data.backup.webdav.host'),
        webdavUser: preferenceService.get('data.backup.webdav.user'),
        webdavPass: preferenceService.get('data.backup.webdav.pass'),
        webdavPath: preferenceService.get('data.backup.webdav.path'),
        fileName,
        skipBackupFile: preferenceService.get('data.backup.webdav.skip_backup_file'),
        disableStream: preferenceService.get('data.backup.webdav.disable_stream')
      }
      const success = await legacyBackupManager.backupToWebdav(null, config, signal)
      if (success === false) throw new Error('WebDAV automatic backup failed')
      return this.cleanupOldBackups(
        type,
        preferenceService.get('data.backup.webdav.max_backups'),
        hostname,
        deviceType,
        () => legacyBackupManager.listWebdavFiles(null, config),
        (oldFileName) => legacyBackupManager.deleteWebdavFile(null, oldFileName, config),
        3
      )
    }

    if (type === 's3') {
      const config: S3Config = {
        endpoint: preferenceService.get('data.backup.s3.endpoint'),
        region: preferenceService.get('data.backup.s3.region'),
        bucket: preferenceService.get('data.backup.s3.bucket'),
        accessKeyId: preferenceService.get('data.backup.s3.access_key_id'),
        secretAccessKey: preferenceService.get('data.backup.s3.secret_access_key'),
        root: preferenceService.get('data.backup.s3.root'),
        fileName,
        skipBackupFile: preferenceService.get('data.backup.s3.skip_backup_file'),
        autoSync: preferenceService.get('data.backup.s3.auto_sync'),
        syncInterval: preferenceService.get('data.backup.s3.sync_interval'),
        maxBackups: preferenceService.get('data.backup.s3.max_backups')
      }
      await legacyBackupManager.backupToS3(null, config, signal)
      return this.cleanupOldBackups(
        type,
        config.maxBackups,
        hostname,
        deviceType,
        () => legacyBackupManager.listS3Files(null, config),
        (oldFileName) => legacyBackupManager.deleteS3File(null, oldFileName, config),
        3
      )
    }

    if (type === 'local') {
      const directory = path.resolve(untildify(preferenceService.get('data.backup.local.dir')))
      await this.validateLocalBackupDirectory(directory)
      await legacyBackupManager.backupToLocalDir(
        null,
        fileName,
        {
          localBackupDir: directory,
          skipBackupFile: preferenceService.get('data.backup.local.skip_backup_file')
        },
        signal
      )
      return this.cleanupOldBackups(
        type,
        preferenceService.get('data.backup.local.max_backups'),
        hostname,
        deviceType,
        () => legacyBackupManager.listLocalBackupFiles(null, directory),
        (oldFileName) => legacyBackupManager.deleteLocalBackupFile(null, oldFileName, directory)
      )
    }

    const credentials = await decryptToken(preferenceService.get('data.backup.nutstore.token'))
    if (!credentials) throw new Error('Nutstore credentials are unavailable')

    const config: WebDavConfig = {
      webdavHost: NUTSTORE_HOST,
      webdavUser: credentials.username,
      webdavPass: credentials.access_token,
      webdavPath: preferenceService.get('data.backup.nutstore.path'),
      fileName,
      skipBackupFile: preferenceService.get('data.backup.nutstore.skip_backup_file')
    }
    const success = await legacyBackupManager.backupToWebdav(null, config, signal)
    if (success === false) throw new Error('Nutstore automatic backup failed')
    return this.cleanupOldBackups(
      type,
      preferenceService.get('data.backup.nutstore.max_backups'),
      hostname,
      deviceType,
      () => legacyBackupManager.listWebdavFiles(null, config),
      (oldFileName) => legacyBackupManager.deleteWebdavFile(null, oldFileName, config)
    )
  }

  private async cleanupOldBackups(
    type: AutoBackupType,
    maxBackups: number,
    hostname: string,
    deviceType: string,
    listFiles: () => Promise<BackupFileInfo[]>,
    deleteFile: (fileName: string) => Promise<unknown>,
    deleteAttempts = 1
  ): Promise<Error | null> {
    if (maxBackups <= 0) return null

    try {
      const currentDeviceSuffix = `.${hostname}.${deviceType}.zip`
      const files = (await listFiles()).filter(
        (file) => file.fileName.startsWith('cherry-studio.') && file.fileName.endsWith(currentDeviceSuffix)
      )
      for (const file of files.slice(maxBackups)) {
        await this.deleteWithRetry(type, file.fileName, deleteFile, deleteAttempts)
      }
      return null
    } catch (error) {
      logger.error('Failed to clean up old automatic backups', error as Error)
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  private async deleteWithRetry(
    type: AutoBackupType,
    fileName: string,
    deleteFile: (fileName: string) => Promise<unknown>,
    maxAttempts: number
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await deleteFile(fileName)
        return
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error
        }
        logger.warn('Failed to delete old automatic backup; retrying', { type, fileName, attempt })
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
      }
    }
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

  private emit(event: AutoBackupEvent): void {
    if (!this.active) return
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'backup.auto_sync_state_changed', event)
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

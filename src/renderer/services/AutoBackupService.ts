import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'

import {
  backupToLocal,
  backupToS3,
  backupToWebdav,
  getBackupSyncState,
  isBackupRunning,
  type RemoteSyncState
} from './BackupService'
import { backupToNutstore, getNutstoreSyncState, isNutstoreBackupRunning } from './NutstoreService'

const logger = loggerService.withContext('AutoBackupService')

const AUTO_BACKUP_TYPES = ['webdav', 's3', 'local', 'nutstore'] as const
const MAX_RETRIES = 4

export type AutoBackupType = (typeof AUTO_BACKUP_TYPES)[number]
type ScheduleType = 'immediate' | 'fromLastSyncTime' | 'fromNow'

interface ScheduleState {
  generation: number
  retryTimeout: ReturnType<typeof setTimeout> | null
  scheduleTimeout: ReturnType<typeof setTimeout> | null
  running: boolean
  cancelRetry: (() => void) | null
}

interface ScheduleSettings {
  enabled: boolean
  intervalMinutes: number
}

const createScheduleState = (): ScheduleState => ({
  generation: 0,
  retryTimeout: null,
  scheduleTimeout: null,
  running: false,
  cancelRetry: null
})

const LOG_PREFIX: Record<AutoBackupType, string> = {
  webdav: '[WebdavAutoSync]',
  s3: '[S3AutoSync]',
  local: '[LocalAutoSync]',
  nutstore: '[NutstoreAutoSync]'
}

/** Owns every automatic-backup timer for the main renderer lifetime. */
export class AutoBackupService {
  private initialized = false
  private readonly schedules: Record<AutoBackupType, ScheduleState> = {
    webdav: createScheduleState(),
    s3: createScheduleState(),
    local: createScheduleState(),
    nutstore: createScheduleState()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    this.initialized = true
    await this.start()
  }

  dispose(): void {
    this.initialized = false
    this.stop()
  }

  async start(immediate = false, type?: AutoBackupType): Promise<void> {
    if (!type) {
      await Promise.all(AUTO_BACKUP_TYPES.map((backupType) => this.start(immediate, backupType)))
      return
    }

    const schedule = this.schedules[type]
    schedule.generation++
    this.clearScheduleTimeout(type)
    this.cancelRetry(type)
    await this.scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', type, schedule.generation)
  }

  stop(type?: AutoBackupType): void {
    if (!type) {
      for (const backupType of AUTO_BACKUP_TYPES) {
        this.stop(backupType)
      }
      return
    }

    const schedule = this.schedules[type]
    schedule.generation++
    this.clearScheduleTimeout(type)
    this.cancelRetry(type)
  }

  private async scheduleNextBackup(
    scheduleType: ScheduleType,
    type: AutoBackupType,
    generation: number
  ): Promise<void> {
    if (!this.isCurrent(type, generation)) return

    this.clearScheduleTimeout(type)
    const settings = await this.getScheduleSettings(type)
    if (!this.isCurrent(type, generation)) return

    if (!settings.enabled || settings.intervalMinutes <= 0) {
      logger.verbose(`${LOG_PREFIX[type]} Invalid or disabled settings, auto backup not scheduled`)
      return
    }

    const requiredInterval = settings.intervalMinutes * 60 * 1000
    const lastSyncTime = this.getSyncState(type).lastSyncTime
    let delay = 1_000

    if (scheduleType === 'fromNow') {
      delay = requiredInterval
    } else if (scheduleType === 'fromLastSyncTime') {
      delay = lastSyncTime
        ? Math.max(1_000, lastSyncTime + requiredInterval - Date.now())
        : type === 'nutstore'
          ? requiredInterval
          : 1_000
    }

    this.schedules[type].scheduleTimeout = setTimeout(() => {
      this.schedules[type].scheduleTimeout = null
      void this.performAutoBackup(type, generation).catch((error) =>
        logger.error(`${LOG_PREFIX[type]} Scheduled backup failed unexpectedly:`, error as Error)
      )
    }, delay)

    logger.verbose(
      `${LOG_PREFIX[type]} Next backup scheduled in ${Math.floor(delay / 1000 / 60)} minutes ${Math.floor(
        (delay / 1000) % 60
      )} seconds`
    )
  }

  private async performAutoBackup(type: AutoBackupType, generation: number): Promise<void> {
    if (!(await this.isEnabled(type, generation))) return

    const schedule = this.schedules[type]
    if (schedule.running || this.isBackupOperationRunning(type)) {
      logger.verbose(`${LOG_PREFIX[type]} Backup already in progress, rescheduling`)
      await this.scheduleNextBackup('fromNow', type, generation)
      return
    }

    schedule.running = true
    let retryCount = 0

    try {
      while (retryCount < MAX_RETRIES && (await this.isEnabled(type, generation))) {
        try {
          logger.verbose(`${LOG_PREFIX[type]} Starting auto backup (attempt ${retryCount + 1}/${MAX_RETRIES})`)
          await this.runBackup(type)
          this.updateSyncState(type, { lastSyncError: null, lastSyncTime: Date.now(), syncing: false })
          return
        } catch (error) {
          retryCount++
          if (!this.isCurrent(type, generation) || !(await this.isEnabled(type, generation))) {
            return
          }

          if (retryCount === MAX_RETRIES) {
            logger.error(`${LOG_PREFIX[type]} Auto backup failed after all retries:`, error as Error)
            const message = getLocalizedBackupErrorMessage(error)
            this.updateSyncState(type, { lastSyncError: message, lastSyncTime: Date.now(), syncing: false })
            toast.error(message)
            return
          }

          const backoffDelay = Math.pow(2, retryCount - 1) * 10_000 - 3_000
          logger.warn(`${LOG_PREFIX[type]} Failed, retry ${retryCount}/${MAX_RETRIES} after ${backoffDelay / 1000}s`)
          if (!(await this.waitForRetry(type, generation, backoffDelay))) {
            return
          }
        }
      }
    } finally {
      schedule.running = false
      this.updateSyncState(type, { syncing: false })
      await this.scheduleNextBackup('fromNow', type, generation)
    }
  }

  private async isEnabled(type: AutoBackupType, generation: number): Promise<boolean> {
    if (!this.isCurrent(type, generation)) return false
    const settings = await this.getScheduleSettings(type)
    return this.isCurrent(type, generation) && settings.enabled && settings.intervalMinutes > 0
  }

  private async getScheduleSettings(type: AutoBackupType): Promise<ScheduleSettings> {
    if (type === 'webdav') {
      const { enabled, host, intervalMinutes } = await preferenceService.getMultiple({
        enabled: 'data.backup.webdav.auto_sync',
        host: 'data.backup.webdav.host',
        intervalMinutes: 'data.backup.webdav.sync_interval'
      })
      return { enabled: enabled && Boolean(host), intervalMinutes }
    }

    if (type === 's3') {
      const { enabled, endpoint, intervalMinutes } = await preferenceService.getMultiple({
        enabled: 'data.backup.s3.auto_sync',
        endpoint: 'data.backup.s3.endpoint',
        intervalMinutes: 'data.backup.s3.sync_interval'
      })
      return { enabled: enabled && Boolean(endpoint), intervalMinutes }
    }

    if (type === 'local') {
      const { directory, enabled, intervalMinutes } = await preferenceService.getMultiple({
        directory: 'data.backup.local.dir',
        enabled: 'data.backup.local.auto_sync',
        intervalMinutes: 'data.backup.local.sync_interval'
      })
      return { enabled: enabled && Boolean(directory), intervalMinutes }
    }

    const { enabled, intervalMinutes, token } = await preferenceService.getMultiple({
      enabled: 'data.backup.nutstore.auto_sync',
      intervalMinutes: 'data.backup.nutstore.sync_interval',
      token: 'data.backup.nutstore.token'
    })
    return { enabled: enabled && Boolean(token), intervalMinutes }
  }

  private getSyncState(type: AutoBackupType): RemoteSyncState {
    if (type === 'nutstore') return getNutstoreSyncState()

    const state = getBackupSyncState()
    if (type === 'webdav') return state.webdavSync
    if (type === 's3') return state.s3Sync
    return state.localBackupSync
  }

  private updateSyncState(type: AutoBackupType, patch: Partial<RemoteSyncState>): void {
    Object.assign(this.getSyncState(type), patch)
  }

  private isBackupOperationRunning(type: AutoBackupType): boolean {
    return type === 'nutstore' ? isNutstoreBackupRunning() : isBackupRunning()
  }

  private async runBackup(type: AutoBackupType): Promise<unknown> {
    if (type === 'webdav') return backupToWebdav({ autoBackupProcess: true })
    if (type === 's3') return backupToS3({ autoBackupProcess: true })
    if (type === 'local') return backupToLocal({ autoBackupProcess: true })
    return backupToNutstore({ autoBackupProcess: true })
  }

  private isCurrent(type: AutoBackupType, generation: number): boolean {
    return this.initialized && this.schedules[type].generation === generation
  }

  private clearScheduleTimeout(type: AutoBackupType): void {
    const schedule = this.schedules[type]
    if (schedule.scheduleTimeout === null) return

    clearTimeout(schedule.scheduleTimeout)
    schedule.scheduleTimeout = null
  }

  private cancelRetry(type: AutoBackupType): void {
    this.schedules[type].cancelRetry?.()
  }

  private waitForRetry(type: AutoBackupType, generation: number, delay: number): Promise<boolean> {
    const schedule = this.schedules[type]
    return new Promise((resolve) => {
      const finish = (shouldContinue: boolean) => {
        if (schedule.retryTimeout !== null) {
          clearTimeout(schedule.retryTimeout)
          schedule.retryTimeout = null
        }
        schedule.cancelRetry = null
        resolve(shouldContinue)
      }

      schedule.cancelRetry = () => finish(false)
      schedule.retryTimeout = setTimeout(() => finish(this.isCurrent(type, generation)), delay)
    })
  }
}

export const autoBackupService = new AutoBackupService()

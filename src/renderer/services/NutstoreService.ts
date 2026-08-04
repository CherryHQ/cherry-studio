/**
 * @deprecated v2 replacement pending. Only auto-sync scheduling and the path
 * picker's directory helper are still this module's; transport, naming and
 * rotation belong to main's BackupService. Sync status stays session-local until
 * the scheduler moves to JobManager.
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { WebDavConfig } from '@shared/types/backup'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'
import { type CreateDirectoryOptions } from 'webdav'

import { backupToDestination, checkDestination } from './backupDestination'
import type { RemoteSyncState } from './BackupService'

const logger = loggerService.withContext('NutstoreService')

// Session-local, non-reactive sync status (mirrors BackupService; see the note there).
const nutstoreSyncState: RemoteSyncState = { lastSyncTime: null, syncing: false, lastSyncError: null }

export const getNutstoreSyncState = () => nutstoreSyncState

const setNutstoreSyncState = (patch: Partial<RemoteSyncState>) => {
  Object.assign(nutstoreSyncState, patch)
}

async function getNutstoreToken() {
  const nutstoreToken = await preferenceService.get('data.backup.nutstore.token')

  if (!nutstoreToken) {
    toast.error(i18n.t('message.error.invalid.nutstore_token'))
    return null
  }
  return nutstoreToken
}

async function createNutstoreConfig(nutstoreToken: string): Promise<WebDavConfig | null> {
  const result = await window.api.nutstore.decryptToken(nutstoreToken)
  if (!result) {
    logger.warn('Invalid nutstore token')
    return null
  }

  const nutstorePath = await preferenceService.get('data.backup.nutstore.path')

  const { username, access_token } = result
  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: username,
    webdavPass: access_token,
    webdavPath: nutstorePath
  }
}

let autoSyncStarted = false
let syncTimeout: NodeJS.Timeout | null = null
let isAutoBackupRunning = false

export async function checkConnection() {
  return checkDestination('nutstore')
}

/**
 * Back up to Nutstore.
 *
 * Only the sync status is this module's now: the token, the archive, its name,
 * the upload and the pruning of old backups all happen in main, which is the
 * only place that can do them without a window open.
 */
export async function backupToNutstore({ showMessage = false, customFileName = '' } = {}) {
  setNutstoreSyncState({ syncing: true, lastSyncError: null })
  try {
    const succeeded = await backupToDestination('nutstore', {
      showMessage,
      ...(customFileName ? { name: customFileName } : {})
    })
    setNutstoreSyncState({ lastSyncError: succeeded ? null : 'Backup failed' })
  } finally {
    setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false })
  }
}

export async function startNutstoreAutoSync() {
  if (autoSyncStarted) {
    return
  }

  const nutstoreToken = await getNutstoreToken()

  if (!nutstoreToken) {
    logger.warn('[startNutstoreAutoSync] Invalid nutstore token, nutstore auto sync disabled')
    return
  }

  autoSyncStarted = true

  stopNutstoreAutoSync()

  await scheduleNextBackup()

  async function scheduleNextBackup() {
    if (syncTimeout) {
      clearTimeout(syncTimeout)
      syncTimeout = null
    }

    const nutstoreSyncInterval = await preferenceService.get('data.backup.nutstore.sync_interval')

    if (nutstoreSyncInterval <= 0) {
      logger.warn('[Nutstore AutoSync] Invalid sync interval, nutstore auto sync disabled')
      stopNutstoreAutoSync()
      return
    }

    // 用户指定的自动备份时间间隔（毫秒）
    const requiredInterval = nutstoreSyncInterval * 60 * 1000

    // 如果存在最后一次同步WebDAV的时间，以它为参考计算下一次同步的时间
    const timeUntilNextSync = nutstoreSyncState.lastSyncTime
      ? Math.max(1000, nutstoreSyncState.lastSyncTime + requiredInterval - Date.now())
      : requiredInterval

    syncTimeout = setTimeout(performAutoBackup, timeUntilNextSync)

    logger.verbose(
      `[Nutstore AutoSync] Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup() {
    if (isAutoBackupRunning) {
      logger.verbose('[Nutstore AutoSync] Backup already in progress, rescheduling')
      await scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    try {
      logger.verbose('[Nutstore AutoSync] Starting auto backup...')
      await backupToNutstore({ showMessage: false })
    } catch (error) {
      logger.error('[Nutstore AutoSync] Auto backup failed:', error as Error)
    } finally {
      isAutoBackupRunning = false
      await scheduleNextBackup()
    }
  }
}

export function stopNutstoreAutoSync() {
  if (syncTimeout) {
    logger.verbose('[Nutstore AutoSync] Stopping nutstore auto sync')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  isAutoBackupRunning = false
  autoSyncStarted = false
}

export async function createDirectory(path: string, options?: CreateDirectoryOptions) {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return
  }
  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  await window.api.backup.createDirectory(config, path, options)
}

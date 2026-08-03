/**
 * @deprecated v2 replacement pending. Like BackupService, this currently uses the retained v1
 * compatibility engine for real archives. Transient sync status remains in the session-local,
 * non-reactive `nutstoreSyncState` below until the native v2 service replaces it.
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import type { WebDavConfig } from '@shared/types/backup'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'
import dayjs from 'dayjs'
import { type CreateDirectoryOptions } from 'webdav'

import type { RemoteSyncState } from './BackupService'

const logger = loggerService.withContext('NutstoreService')

// Session-local, non-reactive sync status (mirrors BackupService; see the note there).
const nutstoreSyncState: RemoteSyncState = { lastSyncTime: null, syncing: false, lastSyncError: null }

export const getNutstoreSyncState = () => nutstoreSyncState

const setNutstoreSyncState = (patch: Partial<RemoteSyncState>) => {
  Object.assign(nutstoreSyncState, patch)
}

async function getNutstoreToken(showMessage = true) {
  const nutstoreToken = await preferenceService.get('data.backup.nutstore.token')

  if (!nutstoreToken) {
    showMessage && toast.error(i18n.t('message.error.invalid.nutstore_token'))
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

export async function checkConnection() {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return false
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return false
  }

  const isSuccess = await window.api.backup.checkWebdavConnection({
    ...config,
    webdavPath: '/'
  })

  return isSuccess
}

let autoSyncStarted = false
let syncTimeout: NodeJS.Timeout | null = null
let isAutoBackupRunning = false
let isManualBackupRunning = false

async function cleanupOldBackups(webdavConfig: WebDavConfig, maxBackups: number): Promise<void> {
  if (maxBackups <= 0) {
    logger.debug('[cleanupOldBackups] Skip cleanup: maxBackups <= 0')
    return
  }

  try {
    const files = await window.api.backup.listWebdavFiles(webdavConfig)

    if (!files || !Array.isArray(files)) {
      logger.warn('[cleanupOldBackups] Failed to list nutstore directory contents')
      return
    }

    const backupFiles = files
      .filter((file) => file.fileName.startsWith('cherry-studio') && file.fileName.endsWith('.zip'))
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())

    if (backupFiles.length < maxBackups) {
      logger.info(`[cleanupOldBackups] No cleanup needed: ${backupFiles.length}/${maxBackups} backups`)
      return
    }

    const filesToDelete = backupFiles.slice(maxBackups - 1)
    logger.info(`[cleanupOldBackups] Deleting ${filesToDelete.length} old backup files`)

    let deletedCount = 0
    for (const file of filesToDelete) {
      try {
        await window.api.backup.deleteWebdavFile(file.fileName, webdavConfig)
        deletedCount++
      } catch (error) {
        logger.error(`[cleanupOldBackups] Failed to delete ${file.basename}:`, error as Error)
      }
    }

    if (deletedCount > 0) {
      logger.info(`[cleanupOldBackups] Successfully deleted ${deletedCount} old backups`)
    }
  } catch (error) {
    logger.error('[cleanupOldBackups] Error during cleanup:', error as Error)
  }
}

export async function backupToNutstore({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const nutstoreToken = await getNutstoreToken(showMessage)
  if (!nutstoreToken) {
    if (autoBackupProcess) {
      throw new Error(i18n.t('message.error.invalid.nutstore_token'))
    }
    return
  }

  if (isManualBackupRunning) {
    logger.verbose('[backupToNutstore] Backup already in progress')
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    if (autoBackupProcess) {
      throw new Error(i18n.t('message.backup.failed'))
    }
    showMessage && toast.error(i18n.t('message.backup.failed'))
    return
  }

  let deviceType = 'unknown'
  try {
    deviceType = (await ipcApi.request('system.get_device_type')) || 'unknown'
  } catch (error) {
    logger.error('[backupToNutstore] Failed to get device type:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  setNutstoreSyncState({ syncing: true, lastSyncError: null })

  const skipBackupFile = await preferenceService.get('data.backup.nutstore.skip_backup_file')
  const maxBackups = await preferenceService.get('data.backup.nutstore.max_backups')

  try {
    // 先清理旧备份
    await cleanupOldBackups(config, maxBackups)

    const isSuccess = await window.api.backup.backupToWebdav({
      ...config,
      fileName: finalFileName,
      skipBackupFile
    })

    if (isSuccess) {
      setNutstoreSyncState({ lastSyncError: null })
      showMessage && toast.success(i18n.t('message.backup.success'))
    } else {
      throw new Error(i18n.t('message.backup.failed'))
    }
  } catch (error) {
    logger.error('[Nutstore] Backup failed:', error as Error)
    if (autoBackupProcess) {
      throw error
    }
    const message = getLocalizedBackupErrorMessage(error)
    setNutstoreSyncState({ lastSyncError: message })
    showMessage && toast.error(message)
  } finally {
    if (!autoBackupProcess) {
      setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false })
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore(fileName?: string) {
  const nutstoreToken = await getNutstoreToken(false)
  if (!nutstoreToken) {
    throw new Error('Nutstore credentials are unavailable')
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    throw new Error('Nutstore credentials are unavailable')
  }

  try {
    await window.api.backup.restoreFromWebdav({ ...config, fileName })
    logger.info('[Nutstore] Backup restore staged, app will restart')
  } catch (error) {
    logger.error('[backup] restoreFromWebdav: Error downloading file from WebDAV:', error as Error)
    throw error
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
    if (isAutoBackupRunning || isManualBackupRunning) {
      logger.verbose('[Nutstore AutoSync] Backup already in progress, rescheduling')
      await scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    const maxRetries = 4
    let retryCount = 0

    try {
      while (retryCount < maxRetries) {
        try {
          logger.verbose(`[Nutstore AutoSync] Starting auto backup... (attempt ${retryCount + 1}/${maxRetries})`)
          await backupToNutstore({ autoBackupProcess: true })
          setNutstoreSyncState({ lastSyncError: null, lastSyncTime: Date.now(), syncing: false })
          break
        } catch (error) {
          retryCount++
          if (retryCount === maxRetries) {
            logger.error('[Nutstore AutoSync] Auto backup failed after all retries:', error as Error)
            const message = getLocalizedBackupErrorMessage(error)
            setNutstoreSyncState({
              lastSyncError: message,
              lastSyncTime: Date.now(),
              syncing: false
            })
            toast.error(message)
          } else {
            const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
            logger.warn(`[Nutstore AutoSync] Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)
            await new Promise((resolve) => setTimeout(resolve, backoffDelay))

            if (!isAutoBackupRunning) {
              logger.info('[Nutstore AutoSync] Retry cancelled by user, exit')
              break
            }
          }
        }
      }
    } finally {
      const shouldReschedule = isAutoBackupRunning
      isAutoBackupRunning = false
      setNutstoreSyncState({ syncing: false })
      if (shouldReschedule) {
        await scheduleNextBackup()
      }
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

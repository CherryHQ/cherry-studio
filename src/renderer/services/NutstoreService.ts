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

let isManualBackupRunning = false

export const isNutstoreBackupRunning = () => isManualBackupRunning

async function cleanupOldBackups(
  webdavConfig: WebDavConfig,
  maxBackups: number,
  hostname: string,
  deviceType: string
): Promise<void> {
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

    const currentDeviceSuffix = `.${hostname}.${deviceType}.zip`
    const backupFiles = files
      .filter((file) => file.fileName.startsWith('cherry-studio.') && file.fileName.endsWith(currentDeviceSuffix))
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())

    if (backupFiles.length <= maxBackups) {
      logger.info(`[cleanupOldBackups] No cleanup needed: ${backupFiles.length}/${maxBackups} backups`)
      return
    }

    const filesToDelete = backupFiles.slice(maxBackups)
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
  let hostname = 'unknown'
  try {
    deviceType = (await ipcApi.request('system.get_device_type')) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('[backupToNutstore] Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  setNutstoreSyncState({ syncing: true, lastSyncError: null })

  const skipBackupFile = await preferenceService.get('data.backup.nutstore.skip_backup_file')
  const maxBackups = await preferenceService.get('data.backup.nutstore.max_backups')

  try {
    const isSuccess = await window.api.backup.backupToWebdav({
      ...config,
      fileName: finalFileName,
      skipBackupFile
    })

    if (isSuccess) {
      await cleanupOldBackups(config, maxBackups, hostname, deviceType)
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

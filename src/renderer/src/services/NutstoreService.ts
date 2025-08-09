import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setNutstoreSyncState } from '@renderer/store/nutstore'
import { WebDavConfig } from '@renderer/types'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import dayjs from 'dayjs'
import { type CreateDirectoryOptions } from 'webdav'

import { getBackupData, handleData } from './BackupService'

const logger = loggerService.withContext('NutstoreService')

function getNutstoreToken() {
  const nutstoreToken = store.getState().nutstore.nutstoreToken

  if (!nutstoreToken) {
    window.message.error({ content: i18n.t('message.error.invalid.nutstore_token'), key: 'nutstore' })
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

  const nutstorePath = store.getState().nutstore.nutstorePath

  const { username, access_token } = result
  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: username,
    webdavPass: access_token,
    webdavPath: nutstorePath
  }
}

export async function checkConnection() {
  const nutstoreToken = getNutstoreToken()
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
  customFileName = ''
}: {
  showMessage?: boolean
  customFileName?: string
} = {}) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  if (isManualBackupRunning) {
    logger.verbose('[backupToNutstore] Backup already in progress')
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let deviceType = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
  } catch (error) {
    logger.error('[backupToNutstore] Failed to get device type:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

  const backupData = await getBackupData()
  const skipBackupFile = store.getState().nutstore.nutstoreSkipBackupFile
  const maxBackups = store.getState().nutstore.nutstoreMaxBackups

  try {
    // 先清理旧备份
    await cleanupOldBackups(config, maxBackups)

    const isSuccess = await window.api.backup.backupToWebdav(backupData, {
      ...config,
      fileName: finalFileName,
      skipBackupFile: skipBackupFile
    })

    if (isSuccess) {
      store.dispatch(setNutstoreSyncState({ lastSyncError: null }))
      showMessage && window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
    } else {
      store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
      window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    }
  } catch (error) {
    store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
    logger.error('[Nutstore] Backup failed:', error as Error)
    window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
  } finally {
    store.dispatch(setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false }))
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore(fileName?: string) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ ...config, fileName })
  } catch (error: any) {
    logger.error('[backup] restoreFromWebdav: Error downloading file from WebDAV:', error as Error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    logger.error('[backup] Error downloading file from WebDAV:', error as Error)
    window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
  }
}

export async function startNutstoreAutoSync() {
  if (autoSyncStarted) {
    return
  }

  const nutstoreToken = getNutstoreToken()

  if (!nutstoreToken) {
    logger.warn('[startNutstoreAutoSync] Invalid nutstore token, nutstore auto sync disabled')
    return
  }

  autoSyncStarted = true

  stopNutstoreAutoSync()

  scheduleNextBackup()

  function scheduleNextBackup() {
    if (syncTimeout) {
      clearTimeout(syncTimeout)
      syncTimeout = null
    }

    const { nutstoreSyncInterval, nutstoreSyncState } = store.getState().nutstore

    if (nutstoreSyncInterval <= 0) {
      logger.warn('[Nutstore AutoSync] Invalid sync interval, nutstore auto sync disabled')
      stopNutstoreAutoSync()
      return
    }

    // 用户指定的自动备份时间间隔（毫秒）
    const requiredInterval = nutstoreSyncInterval * 60 * 1000

    // 如果存在最后一次同步WebDAV的时间，以它为参考计算下一次同步的时间
    const timeUntilNextSync = nutstoreSyncState?.lastSyncTime
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
      scheduleNextBackup()
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
      scheduleNextBackup()
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
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }
  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  await window.api.backup.createDirectory(config, path, options)
}
